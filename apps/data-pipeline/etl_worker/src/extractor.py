"""Document extraction module supporting PDF and HTML files.

Uses pymupdf for PDF text extraction and BeautifulSoup for HTML.
Detects broken/gibberish pages and optionally runs inline OnnxTR OCR.
Requires Python 3.10+ and: pip install pymupdf
"""

import gzip
import json
import logging
import os
import re
import unicodedata
from typing import Dict, List, Optional, Tuple

import boto3
import pymupdf
from bs4 import BeautifulSoup

from s3_utils import upload_json

logger = logging.getLogger(__name__)

# S3 bucket for extracted data (OCR bboxes, etc.)
EXTRACTION_BUCKET = os.environ.get(
    "OCR_OUTPUT_BUCKET",
    os.environ.get("OUTPUT_BUCKET", "filing-extractions-128638789653"),
)

# Gibberish detection thresholds
_GIBBERISH_REPLACEMENT_RATIO = 0.05  # >5% replacement chars → gibberish
_GIBBERISH_UNPRINTABLE_RATIO = 0.10  # >10% non-printable (excl whitespace) → gibberish
_MIN_TEXT_LENGTH = 20  # Pages with less text skip gibberish check (likely blank)

# CloudWatch metric settings (emitted once per gibberish page detected)
_ENABLE_GIBBERISH_METRICS = os.environ.get("ENABLE_GIBBERISH_METRICS", "true").lower() == "true"
_GIBBERISH_METRIC_NAMESPACE = os.environ.get("GIBBERISH_METRIC_NAMESPACE", "AsiaFilings/DataPipeline")
_GIBBERISH_METRIC_NAME = os.environ.get("GIBBERISH_METRIC_NAME", "GibberishPagesDetected")
_cloudwatch_client = None
_cloudwatch_error_logged = False

# OnnxTR OCR settings
_ONNXTR_DET_ARCH = os.environ.get("ONNXTR_DET_ARCH", "db_resnet50")
_ONNXTR_RECO_ARCH = os.environ.get("ONNXTR_RECO_ARCH", "parseq")
_ONNXTR_RECO_FALLBACK_ARCH = os.environ.get("ONNXTR_RECO_FALLBACK_ARCH", "crnn_vgg16_bn")
_onnxtr_predictor = None
_onnxtr_error_logged = False
_onnxtr_engine_config_warning_logged = False


def _read_bool_env(name: str, default: bool) -> bool:
    """Read a bool env var with a safe default."""
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _read_float_env(name: str, default: float) -> float:
    """Read a float env var with a safe default."""
    value = os.environ.get(name)
    if not value:
        return default
    try:
        return float(value)
    except ValueError:
        logger.warning(f"Invalid {name}={value!r}; using default {default}")
        return default


_ONNXTR_RENDER_SCALE = _read_float_env("ONNXTR_RENDER_SCALE", 2.0)
_ONNXTR_LOAD_IN_8_BIT = _read_bool_env("ONNXTR_LOAD_IN_8_BIT", True)
_ENABLE_INLINE_OCR = _read_bool_env("ENABLE_INLINE_OCR", False)


def _get_cloudwatch_client():
    """Get a lazily-initialized CloudWatch client."""
    global _cloudwatch_client
    if _cloudwatch_client is None:
        _cloudwatch_client = boto3.client("cloudwatch")
    return _cloudwatch_client


def _emit_gibberish_metric(exchange: str, page_number: int) -> None:
    """Emit a CloudWatch metric data point for gibberish page detection."""
    global _cloudwatch_error_logged
    if not _ENABLE_GIBBERISH_METRICS:
        return

    try:
        _get_cloudwatch_client().put_metric_data(
            Namespace=_GIBBERISH_METRIC_NAMESPACE,
            MetricData=[
                {
                    "MetricName": _GIBBERISH_METRIC_NAME,
                    "Value": 1,
                    "Unit": "Count",
                    "Dimensions": [
                        {"Name": "Exchange", "Value": exchange or "UNKNOWN"},
                    ],
                }
            ],
        )
    except Exception as e:
        # Keep extraction resilient even if metrics API is unavailable.
        if not _cloudwatch_error_logged:
            logger.warning(
                f"Failed to publish CloudWatch gibberish metric ({_GIBBERISH_METRIC_NAMESPACE}/{_GIBBERISH_METRIC_NAME}): {e}"
            )
            _cloudwatch_error_logged = True
        logger.debug(f"Skipped gibberish metric for page {page_number}")


def _get_onnxtr_predictor():
    """Get a lazily initialized OnnxTR OCR predictor."""
    global _onnxtr_predictor, _onnxtr_error_logged, _onnxtr_engine_config_warning_logged
    if _onnxtr_predictor is not None:
        return _onnxtr_predictor

    try:
        from onnxtr.models import EngineConfig, ocr_predictor

        predictor_kwargs = {
            "det_arch": _ONNXTR_DET_ARCH,
            "load_in_8_bit": _ONNXTR_LOAD_IN_8_BIT,
        }
        try:
            # Pin inference to CPU provider for consistent Fargate runtime behavior.
            cpu_engine_config = EngineConfig(providers=["CPUExecutionProvider"])
            predictor_kwargs["det_engine_cfg"] = cpu_engine_config
            predictor_kwargs["reco_engine_cfg"] = cpu_engine_config
        except Exception as engine_cfg_error:
            if not _onnxtr_engine_config_warning_logged:
                logger.warning(
                    "Failed to configure explicit CPUExecutionProvider for OnnxTR; using defaults: %s",
                    engine_cfg_error,
                )
                _onnxtr_engine_config_warning_logged = True

        # Primary config: high-accuracy detector + recognition model on CPU with 8-bit loading.
        try:
            primary_kwargs = {**predictor_kwargs, "reco_arch": _ONNXTR_RECO_ARCH}
            _onnxtr_predictor = ocr_predictor(
                **primary_kwargs,
            )
            return _onnxtr_predictor
        except Exception as primary_error:
            if _ONNXTR_RECO_FALLBACK_ARCH and _ONNXTR_RECO_FALLBACK_ARCH != _ONNXTR_RECO_ARCH:
                fallback_kwargs = {**predictor_kwargs, "reco_arch": _ONNXTR_RECO_FALLBACK_ARCH}
                logger.warning(
                    "OnnxTR predictor init failed with reco_arch=%s (%s); retrying with fallback reco_arch=%s",
                    _ONNXTR_RECO_ARCH,
                    primary_error,
                    _ONNXTR_RECO_FALLBACK_ARCH,
                )
                _onnxtr_predictor = ocr_predictor(
                    **fallback_kwargs,
                )
                return _onnxtr_predictor
            raise
    except Exception as e:
        if not _onnxtr_error_logged:
            logger.warning(f"Failed to initialize OnnxTR OCR predictor: {e}")
            _onnxtr_error_logged = True
        return None


def warm_onnxtr_predictor() -> bool:
    """Warm the singleton OnnxTR predictor at process startup."""
    predictor = _get_onnxtr_predictor()
    return predictor is not None


def _extract_with_onnxtr(page) -> Dict:
    """Run OnnxTR OCR on a PDF page and map words to PDF-space bounding boxes."""
    import numpy as np

    predictor = _get_onnxtr_predictor()
    if predictor is None:
        raise RuntimeError("OnnxTR predictor unavailable")

    render_scale = max(1.0, _ONNXTR_RENDER_SCALE)
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(render_scale, render_scale), alpha=False)
    image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, pixmap.n)

    result = predictor([image])
    page_result = result.pages[0]
    ocr_text = page_result.render()

    page_width = float(page.rect.width)
    page_height = float(page.rect.height)
    ocr_bboxes = []

    for block in page_result.blocks:
        for line in block.lines:
            for word in line.words:
                value = (word.value or "").strip()
                if not value:
                    continue

                geometry = word.geometry
                if not geometry or len(geometry) != 2:
                    continue

                x0n, y0n = geometry[0]
                x1n, y1n = geometry[1]
                x0 = float(x0n) * page_width
                y0 = float(y0n) * page_height
                x1 = float(x1n) * page_width
                y1 = float(y1n) * page_height

                if x0 > x1:
                    x0, x1 = x1, x0
                if y0 > y1:
                    y0, y1 = y1, y0

                ocr_bboxes.append(
                    {
                        "x0": round(max(0.0, x0), 1),
                        "y0": round(max(0.0, y0), 1),
                        "x1": round(min(page_width, x1), 1),
                        "y1": round(min(page_height, y1), 1),
                        "word": value,
                    }
                )

    return {
        "text": ocr_text,
        "ocr_required": True,
        "ocr_bboxes": ocr_bboxes,
    }


def decompress_if_gzip(data: bytes) -> bytes:
    """Decompress gzip data if detected, otherwise return as-is."""
    if data[:2] == b'\x1f\x8b':
        try:
            return gzip.decompress(data)
        except Exception as e:
            logger.warning(f"Failed to decompress gzip: {e}")
    return data


def parse_s3_key_metadata(s3_key: str) -> Dict:
    """Parse metadata from S3 key path.

    Supports formats:
        - {exchange}/{company_id}/{year}/{month}/{day}/{source_id}.{ext}
        - {exchange}/{company_id}/{source_id}.{ext}
        - {source_id}.{ext}

    Returns:
        Dictionary with parsed metadata fields
    """
    metadata = {}
    key_no_ext = re.sub(r'\.(pdf|htm|html|doc|docx)$', '', s3_key, flags=re.IGNORECASE)
    parts = key_no_ext.split('/')

    if len(parts) >= 6:
        metadata['exchange'] = parts[-6].upper()
        metadata['company_id'] = parts[-5]
        try:
            year, month, day = parts[-4], parts[-3], parts[-2]
            metadata['filing_date'] = f"{year}-{month}-{day}"
        except (ValueError, IndexError):
            pass
        metadata['source_id'] = parts[-1]
    elif len(parts) >= 3:
        metadata['exchange'] = parts[-3].upper()
        metadata['company_id'] = parts[-2]
        metadata['source_id'] = parts[-1]
    elif len(parts) >= 1:
        metadata['source_id'] = parts[-1]

    return metadata


def process_html_bytes(
    html_bytes: bytes,
    filename: str,
    s3_key: Optional[str] = None,
    exchange: Optional[str] = None,
    document_id: Optional[str] = None,
    metadata: Optional[Dict] = None
) -> Tuple[List[Dict], Optional[str], List[int]]:
    """Process HTML bytes and extract text.

    Args:
        html_bytes: Raw HTML file bytes
        filename: Original filename
        s3_key: Full S3 key path
        exchange: Exchange identifier
        document_id: Optional document ID override
        metadata: Optional metadata dict to merge

    Returns:
        Tuple of (page_records, error_message_or_none, broken_pages)
    """
    key_metadata = parse_s3_key_metadata(s3_key) if s3_key else {}

    merged_meta = {**key_metadata}
    if metadata:
        merged_meta.update({k: v for k, v in metadata.items() if v})
    if exchange:
        merged_meta['exchange'] = exchange
    if document_id:
        merged_meta['source_id'] = document_id

    doc_id = merged_meta.get('source_id') or filename.rsplit('.', 1)[0]

    try:
        html_bytes = decompress_if_gzip(html_bytes)

        html_text = None
        for encoding in ['utf-8', 'gb2312', 'big5', 'latin-1']:
            try:
                html_text = html_bytes.decode(encoding)
                break
            except (UnicodeDecodeError, LookupError):
                continue

        if html_text is None:
            html_text = html_bytes.decode('utf-8', errors='ignore')

        soup = BeautifulSoup(html_text, 'html.parser')

        for element in soup(['script', 'style', 'head', 'meta', 'link']):
            element.decompose()

        text = soup.get_text(separator='\n', strip=True)
        text = re.sub(r'\n{3,}', '\n\n', text)

    except Exception as e:
        logger.error(f"Failed to process HTML {filename}: {e}")
        return [], str(e), []

    exch = merged_meta.get('exchange', '')
    unique_page_id = f"{exch}_{doc_id}_pg1" if exch else f"{doc_id}_pg1"

    page_data = {
        "unique_page_id": unique_page_id,
        "document_id": doc_id,
        "page_number": 1,
        "total_pages": 1,
        "text": text,
        "s3_key": s3_key or "",
        "file_type": "html",
    }

    for key in ('exchange', 'company_id', 'company_name', 'filing_date', 'filing_type', 'title'):
        if merged_meta.get(key):
            page_data[key] = merged_meta[key]

    logger.info(f"Extracted 1 page from {filename} (HTML)")
    return [page_data], None, []


def is_gibberish(text: str) -> bool:
    """Detect if extracted text is gibberish from broken PDF font encoding.

    Checks for:
    1. High ratio of U+FFFD replacement characters
    2. High ratio of non-printable / control characters (excluding whitespace)
    3. High ratio of Private Use Area codepoints (U+E000–U+F8FF)

    Returns True if the text appears to be garbled/unmapped glyphs.
    """
    if len(text.strip()) < _MIN_TEXT_LENGTH:
        return False  # Too short to judge; likely a blank or near-blank page

    total = len(text)

    # Count replacement characters (U+FFFD)
    replacement_count = text.count('\ufffd')
    if replacement_count / total > _GIBBERISH_REPLACEMENT_RATIO:
        return True

    # Count non-printable chars and Private Use Area codepoints
    bad_count = 0
    for ch in text:
        if ch in (' ', '\t', '\n', '\r'):
            continue
        cat = unicodedata.category(ch)
        # Cc = control, Cn = unassigned, Co = private use, Cs = surrogate
        if cat in ('Cc', 'Cn', 'Co', 'Cs'):
            bad_count += 1

    if bad_count / total > _GIBBERISH_UNPRINTABLE_RATIO:
        return True

    return False


def _extract_page_text(
    page,
    exchange: str = "",
    enable_inline_ocr: bool = _ENABLE_INLINE_OCR,
) -> Dict:
    """Extract text from a pymupdf page, falling back to OCR if needed.

    Returns:
        Dict with keys: text, ocr_required, and optionally ocr_bboxes.
    """
    text = page.get_text("text")

    if not is_gibberish(text):
        return {"text": text, "ocr_required": False}

    _emit_gibberish_metric(exchange, page.number + 1)

    if not enable_inline_ocr:
        logger.info(
            "Page %s: gibberish detected, inline OCR disabled; deferring OCR",
            page.number + 1,
        )
        # Avoid indexing gibberish text before async OCR patch documents arrive.
        return {"text": "", "ocr_required": True, "ocr_bboxes": []}

    # Text is gibberish — fall back to OnnxTR OCR.
    logger.info(f"Page {page.number + 1}: gibberish detected, running OnnxTR OCR")
    try:
        return _extract_with_onnxtr(page)
    except Exception as e:
        logger.error(f"OnnxTR OCR failed on page {page.number + 1}: {e}")
        # Return original (gibberish) text as fallback, still mark as broken
        return {"text": text, "ocr_required": True, "ocr_bboxes": []}


def process_pdf_bytes(
    pdf_bytes: bytes,
    filename: str,
    s3_key: Optional[str] = None,
    exchange: Optional[str] = None,
    document_id: Optional[str] = None,
    metadata: Optional[Dict] = None,
    enable_inline_ocr: Optional[bool] = None,
) -> Tuple[List[Dict], Optional[str], List[int]]:
    """Process PDF bytes and extract text per page.

    Uses pymupdf's dict output to extract text blocks.

    Args:
        pdf_bytes: Raw PDF file bytes
        filename: Original filename (used for ID generation)
        s3_key: Full S3 key path (used to parse metadata)
        exchange: Exchange identifier (e.g., 'DART', 'HKEX', 'SEC')
        document_id: Optional document ID override
        metadata: Optional metadata dict (from lookup) to merge into results

    Returns:
        Tuple of (page_records, error_message_or_none, broken_pages)
    """
    pages_result = []

    key_metadata = parse_s3_key_metadata(s3_key) if s3_key else {}

    merged_meta = {**key_metadata}
    if metadata:
        merged_meta.update({k: v for k, v in metadata.items() if v})
    if exchange:
        merged_meta['exchange'] = exchange
    if document_id:
        merged_meta['source_id'] = document_id

    doc_id = merged_meta.get('source_id') or filename.rsplit('.', 1)[0]

    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        logger.error(f"Failed to open PDF {filename}: {e}")
        return [], str(e), []

    try:
        total_pages = len(doc)
        exch = merged_meta.get('exchange', '')
        broken_pages = []
        inline_ocr_enabled = _ENABLE_INLINE_OCR if enable_inline_ocr is None else enable_inline_ocr

        for page_num, page in enumerate(doc, start=1):
            extraction = _extract_page_text(
                page,
                exchange=exch,
                enable_inline_ocr=inline_ocr_enabled,
            )

            unique_page_id = f"{exch}_{doc_id}_pg{page_num}" if exch else f"{doc_id}_pg{page_num}"

            result_page = {
                "unique_page_id": unique_page_id,
                "document_id": doc_id,
                "page_number": page_num,
                "total_pages": total_pages,
                "text": extraction["text"],
                "ocr_required": extraction["ocr_required"],
                "s3_key": s3_key or "",
                "file_type": "pdf",
            }

            for key in ('exchange', 'company_id', 'company_name', 'filing_date', 'filing_type', 'title'):
                if merged_meta.get(key):
                    result_page[key] = merged_meta[key]

            # Upload OCR bounding boxes to S3 for pages that needed OCR
            if extraction["ocr_required"]:
                broken_pages.append(page_num)
                bboxes = extraction.get("ocr_bboxes", [])
                if bboxes:
                    bbox_key = f"ocr-bboxes/{exch.lower()}/{doc_id}/page_{page_num}.json"
                    upload_json(EXTRACTION_BUCKET, bbox_key, bboxes)

            pages_result.append(result_page)

    finally:
        doc.close()

    ocr_count = len(broken_pages)
    if ocr_count > 0:
        logger.info(
            f"Extracted {len(pages_result)} pages from {filename} "
            f"({ocr_count} pages required OCR: {broken_pages})"
        )
    else:
        logger.info(f"Extracted {len(pages_result)} pages from {filename}")

    return pages_result, None, broken_pages


def get_file_type(filename: str) -> str:
    """Determine file type from filename extension.

    Args:
        filename: Filename or S3 key

    Returns:
        File type string: 'pdf', 'html', 'doc', or 'unknown'
    """
    lower = filename.lower()
    if lower.endswith('.pdf'):
        return 'pdf'
    elif lower.endswith(('.htm', '.html')):
        return 'html'
    elif lower.endswith(('.doc', '.docx')):
        return 'doc'
    return 'unknown'


def detect_file_type_from_content(data: bytes) -> str:
    """Detect file type from content magic bytes.

    Args:
        data: First bytes of file content

    Returns:
        File type string: 'pdf', 'html', or 'unknown'
    """
    # Check for gzip and decompress if needed
    if data[:2] == b'\x1f\x8b':
        try:
            data = gzip.decompress(data)
        except Exception:
            pass

    # PDF magic bytes: %PDF
    if data[:4] == b'%PDF':
        return 'pdf'

    # HTML detection - check for common patterns
    # Try to decode first 1000 bytes to check for HTML markers
    try:
        text_start = data[:1000].decode('utf-8', errors='ignore').lower().strip()
        if text_start.startswith('<!doctype html') or text_start.startswith('<html'):
            return 'html'
        if '<html' in text_start or '<!doctype' in text_start:
            return 'html'
    except Exception:
        pass

    return 'unknown'


def process_document_bytes(
    doc_bytes: bytes,
    filename: str,
    s3_key: Optional[str] = None,
    exchange: Optional[str] = None,
    document_id: Optional[str] = None,
    metadata: Optional[Dict] = None
) -> Tuple[List[Dict], Optional[str], List[int]]:
    """Process document bytes and extract text, auto-detecting file type.

    Supports:
        - PDF files (.pdf) - uses pymupdf
        - HTML files (.htm, .html) - uses BeautifulSoup

    Args:
        doc_bytes: Raw file bytes
        filename: Original filename (used to detect type)
        s3_key: Full S3 key path
        exchange: Exchange identifier
        document_id: Optional document ID override
        metadata: Optional metadata dict to merge

    Returns:
        Tuple of (page_records, error_message_or_none, broken_pages)
    """
    file_type = get_file_type(s3_key or filename)

    # Fall back to content-based detection if extension is unknown
    if file_type == 'unknown':
        file_type = detect_file_type_from_content(doc_bytes)
        if file_type != 'unknown':
            logger.info(f"Detected {file_type} from content for {filename}")

    if file_type == 'pdf':
        return process_pdf_bytes(
            doc_bytes, filename, s3_key, exchange, document_id, metadata
        )
    elif file_type == 'html':
        return process_html_bytes(
            doc_bytes, filename, s3_key, exchange, document_id, metadata
        )
    else:
        logger.warning(f"Unsupported file type for {filename}, skipping")
        return [], f"Unsupported file type: {file_type}", []
