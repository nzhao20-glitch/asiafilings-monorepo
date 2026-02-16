"""Document extraction module supporting PDF and HTML files.

Uses pymupdf for PDF text extraction and BeautifulSoup for HTML.
Requires Python 3.10+ and: pip install pymupdf
"""

import gzip
import logging
import re
from typing import Dict, List, Optional, Tuple

import pymupdf
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


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
) -> Tuple[List[Dict], Optional[str]]:
    """Process HTML bytes and extract text.

    Args:
        html_bytes: Raw HTML file bytes
        filename: Original filename
        s3_key: Full S3 key path
        exchange: Exchange identifier
        document_id: Optional document ID override
        metadata: Optional metadata dict to merge

    Returns:
        Tuple of (page_records, error_message_or_none)
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
        return [], str(e)

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
    return [page_data], None


def _extract_page_text(page) -> str:
    """Extract text from a pymupdf page.

    Returns:
        The full page text.
    """
    return page.get_text("text")


def process_pdf_bytes(
    pdf_bytes: bytes,
    filename: str,
    s3_key: Optional[str] = None,
    exchange: Optional[str] = None,
    document_id: Optional[str] = None,
    metadata: Optional[Dict] = None
) -> Tuple[List[Dict], Optional[str]]:
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
        Tuple of (page_records, error_message_or_none)
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
        return [], str(e)

    try:
        total_pages = len(doc)
        exch = merged_meta.get('exchange', '')

        for page_num, page in enumerate(doc, start=1):
            text = _extract_page_text(page)

            unique_page_id = f"{exch}_{doc_id}_pg{page_num}" if exch else f"{doc_id}_pg{page_num}"

            result_page = {
                "unique_page_id": unique_page_id,
                "document_id": doc_id,
                "page_number": page_num,
                "total_pages": total_pages,
                "text": text,
                "s3_key": s3_key or "",
                "file_type": "pdf",
            }

            for key in ('exchange', 'company_id', 'company_name', 'filing_date', 'filing_type', 'title'):
                if merged_meta.get(key):
                    result_page[key] = merged_meta[key]

            pages_result.append(result_page)

    finally:
        doc.close()

    logger.info(f"Extracted {len(pages_result)} pages from {filename}")
    return pages_result, None


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
) -> Tuple[List[Dict], Optional[str]]:
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
        Tuple of (page_records, error_message_or_none)
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
        return [], f"Unsupported file type: {file_type}"
