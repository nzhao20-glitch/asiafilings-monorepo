# OCR Decoupling Plan (SQS + Fargate Spot OCR Worker)

Last updated: 2026-02-18

## 1. Goal
Move OCR out of the inline ETL extraction path so large filings with many broken pages do not stall Batch workers.

Target behavior:
- ETL extraction worker only detects broken pages and publishes OCR work to SQS.
- Separate OCR worker service consumes queue messages, runs OnnxTR on specific pages, and writes word/bbox JSON to S3.
- OCR workers scale automatically with queue depth on Fargate Spot, up to a configurable cap (128/256).

---

## 2. Current State (Important Context)

### 2.1 What is already implemented
- `broken_pages` is detected and tracked in ETL.
- ETL attempts to write `broken_pages` to Postgres (`filings.broken_pages`) when `DATABASE_URL` is set.
- Frontend uses `GET /documents/:docId/pages/:pageNum/ocr-bboxes` and renders OCR bboxes in PDF.js coordinate space.
- OCR path is currently inline during extraction (OnnxTR fallback) and therefore blocks Batch job runtime for broken pages.
- The `filings.broken_pages` column must exist in the target DB before rollout (migration exists in repo but must be applied in environment).

### 2.2 Relevant files
- Inline OCR path: `apps/data-pipeline/etl_worker/src/extractor.py`
- ETL orchestration: `apps/data-pipeline/etl_worker/src/main.py`
- Batch trigger script: `apps/data-pipeline/scripts/trigger_batch.py`
- Existing Batch infra: `apps/data-pipeline/infra/modules/batch/main.tf`
- Existing S3->SQS (Quickwit) infra: `apps/data-pipeline/infra/modules/s3/main.tf`
- OCR API route (GET only): `apps/web-platform/backend/src/routes/documents.ts`
- OCR text-layer consumer in frontend: `apps/web-platform/frontend/src/components/document/OcrTextLayer.tsx`

### 2.3 Current trigger behavior
- Extraction is **not automatically triggered by raw PDF uploads**.
- Extraction is triggered via manifest + Batch submission (`scripts/trigger_batch.py`).
- The only auto S3 notification currently in data-pipeline infra is processed JSONL -> Quickwit SQS.

---

## 3. Desired Architecture

## 3.1 High-level flow
1. Manifest-driven Batch ETL runs (same as today).
2. For each filing:
   - detect broken pages only
   - update `filings.broken_pages`
   - send OCR job(s) to SQS with S3 URL + broken page list
3. OCR worker service (ECS/Fargate Spot) consumes SQS:
   - fetch PDF page(s)
   - OCR with OnnxTR
   - write `ocr-bboxes/{exchange}/{source_id}/page_{n}.json`
4. Frontend continues fetching bbox JSON from existing backend GET route.

### 3.2 Message schema (v1)
```json
{
  "version": 1,
  "exchange": "HKEX",
  "source_id": "11805134",
  "s3_bucket": "pdfs-128638789653",
  "s3_key": "hkex/.../11805134.pdf",
  "broken_pages": [3,4,5,6],
  "submitted_at": "2026-02-18T00:00:00Z"
}
```

Recommended chunking:
- Keep messages small and bounded by OCR time.
- `OCR_PAGE_CHUNK_SIZE=5..20` pages per message.

---

## 4. Scaling Model (Answer to “1 instance per message up to N”)

### 4.1 Recommended
Use ECS Service Auto Scaling on SQS queue depth:
- `min_capacity = 0`
- `max_capacity = 128` (or `256`)
- Target: ~1 visible message per running task (approximate 1 task/message behavior)

This is the practical approach; strict 1:1 is not guaranteed at every instant but converges quickly.

### 4.2 If strict 1:1 is required
Add a lightweight controller (Lambda/EventBridge every 30-60s) that sets desired tasks to:
- `desired = min(max_capacity, visible_messages)`
This provides deterministic mapping but adds extra moving parts.

### 4.3 Spot resilience
- Use Fargate Spot capacity provider for cost.
- Expect interruptions; rely on SQS visibility timeout + retries + DLQ.

---

## 5. Execution Phases

## Phase 0: Guardrails and feature flags
1. Add feature flags (env-driven):
   - `ENABLE_INLINE_OCR` (default `false` in Batch)
   - `ENABLE_OCR_QUEUE` (default `true` in Batch)
   - `OCR_QUEUE_URL`
   - `OCR_PAGE_CHUNK_SIZE` (default 10)
2. Keep backward compatibility:
   - if queue env not set, ETL continues without OCR queue publishing.

Acceptance:
- ETL compiles and runs with queue disabled and inline OCR disabled.

---

## Phase 0.5: Database schema prerequisite (`filings.broken_pages`)
1. Apply DB migration before enabling OCR queue publishing:
   - Prisma migration file: `apps/web-platform/backend/prisma/migrations/20260217000000_add_broken_pages/migration.sql`
   - SQL: `ALTER TABLE "filings" ADD COLUMN "broken_pages" INTEGER[] DEFAULT '{}';`
2. Validate schema in target environment:
   - confirm column exists and defaults to empty array
   - confirm ETL service role/user has `UPDATE` permission on `filings.broken_pages`
3. Rollback note:
   - this is additive/non-breaking; no code rollback required if applied early.

Acceptance:
- `\d+ filings` (or equivalent) shows `broken_pages integer[]`.
- ETL no longer logs DB warnings for missing `broken_pages` column.

---

## Phase 1: ETL detection-only + queue publisher
1. Refactor extraction path:
   - In `extractor.py`, add detection-only path for gibberish pages when inline OCR is disabled.
   - Keep `broken_pages` generation unchanged.
2. Add new helper module, e.g. `etl_worker/src/ocr_queue.py`:
   - lazy SQS client
   - message chunking
   - `enqueue_ocr_jobs(exchange, source_id, s3_bucket, s3_key, broken_pages)`
3. Update `main.py`:
   - after `process_document_bytes` returns, call DB update for broken pages (existing)
   - enqueue OCR messages when broken pages exist and queue is configured

Acceptance:
- ETL job runtime for heavily broken PDFs drops significantly versus inline OCR path.
- SQS messages are emitted with expected schema/chunking.

---

## Phase 2: OCR worker implementation
1. Add new worker entrypoint: `etl_worker/src/ocr_worker.py`
2. Worker loop:
   - `ReceiveMessage` (long poll)
   - parse payload and validate required fields
   - download PDF from S3
   - OCR only specified pages with OnnxTR
   - upload per-page bbox JSON to existing key scheme
   - delete SQS message on success
3. Failure handling:
   - throw on transient errors to allow retry
   - permanently malformed payloads -> send to DLQ (via max receive count)
4. Idempotency:
   - overwrite-safe S3 writes for same `(exchange, source_id, page)`

Acceptance:
- Manual enqueue of a known filing/page range yields correct bbox JSON in S3.
- Reprocessing same message is safe.

---

## Phase 3: Terraform infra for OCR queue + service + autoscaling
1. Add OCR queue resources:
   - primary queue + DLQ + redrive policy
2. Add ECS resources (new module recommended: `infra/modules/ocr_worker`):
   - ECS cluster (or reuse if existing)
   - task definition for OCR worker container
   - service with desired count 0
   - Fargate Spot capacity provider strategy
3. Add IAM:
   - consume/delete from OCR queue
   - read raw PDFs bucket
   - write extraction bucket `ocr-bboxes/*`
   - CloudWatch logs
4. Add autoscaling:
   - scalable target (service desired count)
   - policy based on SQS queue depth
   - max capacity configurable (`128` or `256`)
5. Wire outputs/vars in root:
   - expose OCR queue URL/ARN
   - inject `OCR_QUEUE_URL` into Batch ETL env

Acceptance:
- `terraform plan` shows expected additions only.
- Service scales from 0 upward as queue accumulates.

---

## Phase 4: Container build/runtime split
1. Keep one image with dual entrypoints OR split images:
   - Option A (simpler): one image; Batch entrypoint `main.py`, ECS service command `python ocr_worker.py`
   - Option B (cleaner): separate Docker targets/images for extract and OCR worker
2. Ensure OnnxTR cpu-headless dependency remains in OCR runtime.

Acceptance:
- Both ETL Batch worker and OCR worker start with correct command/env.

---

## Phase 5: Validation and soak
1. Functional:
   - Run small manifest (10-100 filings)
   - confirm broken pages are detected and queue messages emitted
   - confirm OCR worker drains queue and writes bbox JSON
2. Performance:
   - compare ETL duration before/after inline OCR removal
   - monitor queue backlog and task scaling behavior
3. Correctness:
   - visual check overlays on several pages (already available tooling)

Acceptance:
- No ETL hangs due to OCR-heavy filings.
- OCR backlog drains with autoscaling.

---

## Phase 6: Rollout
1. Deploy infra first (queues/service/autoscaling).
2. Deploy ETL worker with:
   - `ENABLE_INLINE_OCR=false`
   - `ENABLE_OCR_QUEUE=true`
3. Run canary backfill batch, then full backfill.
4. Watch alarms/metrics for 24h.

---

## 6. Detailed File Change Map

### ETL app
- `apps/data-pipeline/etl_worker/src/extractor.py`
  - add detection-only mode and keep broken page detection
- `apps/data-pipeline/etl_worker/src/main.py`
  - publish OCR queue messages
- `apps/data-pipeline/etl_worker/src/ocr_queue.py` (new)
  - SQS publisher + chunking
- `apps/data-pipeline/etl_worker/src/ocr_worker.py` (new)
  - queue consumer + OCR execution
- `apps/data-pipeline/etl_worker/requirements.txt`
  - keep `onnxtr[cpu-headless]`

### Infra
- `apps/data-pipeline/infra/main.tf`
  - include new OCR module + wiring
- `apps/data-pipeline/infra/variables.tf`
  - add queue/service scaling vars
- `apps/data-pipeline/infra/outputs.tf`
  - output OCR queue URL/ARN/service info
- `apps/data-pipeline/infra/modules/ocr_worker/*` (new)
  - SQS, DLQ, ECS task/service, autoscaling, IAM
- `apps/data-pipeline/infra/modules/batch/main.tf`
  - inject OCR queue env vars into Batch ETL job definition

### Docs
- `apps/data-pipeline/README.md`
  - update architecture and operational commands

---

## 7. Suggested Defaults

- `OCR_PAGE_CHUNK_SIZE=10`
- `OCR_MAX_TASKS=128` initially (raise to 256 after soak)
- `SQS visibility timeout=10-20 min` (tune to worst-case chunk)
- `SQS receive wait=20s`
- `DLQ maxReceiveCount=5`

---

## 8. Observability and Alarms

Track:
- `ApproximateNumberOfMessagesVisible` (OCR queue)
- `ApproximateAgeOfOldestMessage`
- ECS running task count
- OCR worker errors/exceptions
- DLQ message count

Alarms:
- queue age > threshold (e.g., 15 min)
- DLQ > 0
- OCR worker crash loop/high error rate

---

## 9. Risks and Mitigations

1. **Search quality lag** (OCR async)
- Risk: Quickwit indexes extraction output before OCR text correction.
- Mitigation:
  - Phase A: keep display correctness via bbox overlays
  - Phase B (optional): add OCR text patch pipeline/reindex for broken pages

2. **Spot interruptions**
- Mitigation: SQS retry semantics + idempotent writes + DLQ.

3. **Large messages / long processing time**
- Mitigation: page chunking + bounded chunk size + visibility timeout tuning.

4. **Cost spikes when queue surges**
- Mitigation: max task cap (128/256), queue-age alarms, adaptive chunk size.

---

## 10. Runbook Commands (for fresh session)

## 10.1 Validation commands
```bash
npm run nx:safe -- run data-pipeline:lint
npm run nx:safe -- run backend:typecheck
```

## 10.2 Infra plan/apply
```bash
cd apps/data-pipeline/infra
terraform init
terraform plan
terraform apply
```

## 10.3 Trigger extraction batch
```bash
cd apps/data-pipeline
python scripts/trigger_batch.py \
  --manifest-bucket <manifest-bucket> \
  --manifest-key <manifest-key> \
  --exchange HKEX \
  --chunk-size 1000
```

## 10.4 Watch OCR backlog
```bash
aws sqs get-queue-attributes \
  --queue-url <ocr-queue-url> \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible ApproximateAgeOfOldestMessage
```

---

## 11. Definition of Done

- Inline OCR removed from critical extraction path for production ETL runs.
- Broken pages always detected and written to DB.
- OCR jobs emitted to SQS with chunked page ranges.
- OCR worker service drains queue and writes per-page bbox JSON.
- Service autoscales from 0 up to configured max on Fargate Spot.
- Dashboard + alarms in place.
- Backfill of 40k can run without long-file OCR tail blocking Batch ETL.
