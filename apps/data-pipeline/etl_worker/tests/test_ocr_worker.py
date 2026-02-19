import unittest
from unittest.mock import patch

import ocr_worker


class _FakeBody:
    def read(self):
        return b"%PDF-FAKE"


class _FakeS3Client:
    def get_object(self, Bucket, Key):  # noqa: N803 - boto3 style
        return {"Body": _FakeBody()}


class _FakePage:
    def __init__(self, page_number):
        self.page_number = page_number


class _FakeDocument:
    def __init__(self, page_count):
        self._pages = [_FakePage(index + 1) for index in range(page_count)]

    def __len__(self):
        return len(self._pages)

    def __getitem__(self, index):
        return self._pages[index]

    def close(self):
        return None


class OcrWorkerPageSelectionTests(unittest.TestCase):
    def test_process_job_only_ocrs_selected_broken_pages(self):
        extracted_pages = []
        uploaded_bbox_keys = []
        uploaded_patch_records = []

        def _fake_extract(page):
            extracted_pages.append(page.page_number)
            return {"text": f"text-{page.page_number}", "ocr_bboxes": [{"page": page.page_number}]}

        def _fake_upload_json(_bucket, key, _payload, client=None):
            uploaded_bbox_keys.append(key)
            return True

        def _fake_upload_jsonl(_bucket, _key, records, client=None):
            uploaded_patch_records.extend(records)
            return True

        job = ocr_worker.OcrJob(
            exchange="HKEX",
            source_id="123",
            s3_bucket="pdfs-bucket",
            s3_key="hkex/00001/report.pdf",
            broken_pages=[2, 4],
            metadata={},
        )

        with (
            patch.object(ocr_worker.pymupdf, "open", return_value=_FakeDocument(6)),
            patch.object(ocr_worker, "_extract_with_onnxtr", side_effect=_fake_extract),
            patch.object(ocr_worker, "upload_json", side_effect=_fake_upload_json),
            patch.object(ocr_worker, "upload_jsonl", side_effect=_fake_upload_jsonl),
            patch.object(ocr_worker, "_object_exists", return_value=False),
        ):
            processed, _patch_key = ocr_worker._process_job(
                job=job,
                s3_client=_FakeS3Client(),
                output_bucket="filing-extractions",
                output_prefix="processed",
            )

        self.assertEqual(processed, 2)
        self.assertEqual(extracted_pages, [2, 4])
        self.assertEqual(
            uploaded_bbox_keys,
            [
                "ocr-bboxes/hkex/123/page_2.json",
                "ocr-bboxes/hkex/123/page_4.json",
            ],
        )
        self.assertEqual([record["page_number"] for record in uploaded_patch_records], [2, 4])


if __name__ == "__main__":
    unittest.main()
