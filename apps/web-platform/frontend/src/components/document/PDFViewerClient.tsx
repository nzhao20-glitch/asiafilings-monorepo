'use client';
// Force recompilation with correct react-window v2 API

import { useState, useEffect, useRef, memo, useCallback, useMemo } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';
import { Document, Page, pdfjs } from 'react-pdf';
import { List } from 'react-window';
import { HighlightOverlay } from './HighlightOverlay';
import { CustomTextLayer } from './CustomTextLayer';
import { encodeHighlight, decodeHighlight, type HighlightData } from '@/src/utils/highlight-encoding';
import { documentOcrApi } from '@/src/services/api';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// Configure PDF.js worker - use react-pdf's bundled worker version
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Display scale for PDF rendering - renders directly at this scale for accurate text layer
// Using 2.0x provides good quality while maintaining text layer accuracy
const DISPLAY_SCALE = 2.0;

// For high-DPI canvas rendering, we can use a separate canvas scale
// This improves visual quality without affecting text layer positioning
const CANVAS_SCALE_FACTOR = window.devicePixelRatio || 1;

// Target display width for PDF pages (normalized)
// All pages will be scaled to fit this width for consistent display
const TARGET_DISPLAY_WIDTH = 595 * DISPLAY_SCALE;  // ~1190px (A4 width)

// Estimated page dimensions for initial render (at display scale)
// Based on A4 at 72 DPI (595x842 points) rendered at DISPLAY_SCALE
const ESTIMATED_PAGE_WIDTH = TARGET_DISPLAY_WIDTH;
const ESTIMATED_PAGE_HEIGHT = 842 * DISPLAY_SCALE; // ~1684px

interface PDFViewerClientProps {
  fileUrl: string;
  filingId?: string;
  searchQuery?: string;
  searchTrigger?: number;
  onOutlineLoad?: (outline: any[]) => void;
  navigationRef?: React.MutableRefObject<((dest: any) => void) | null>;
  initialPage?: number;
}

/**
 * Copy text to clipboard with fallback for non-secure contexts (HTTP)
 */
const copyToClipboard = async (text: string): Promise<boolean> => {
  // Try modern Clipboard API first
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to fallback
    }
  }

  // Fallback for HTTP contexts: use execCommand
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textArea);
    return success;
  } catch {
    console.error('Clipboard copy failed');
    return false;
  }
};

/**
 * Memoized PDF Page component with text and annotation layers
 * Renders directly at DISPLAY_SCALE for accurate text layer positioning
 * Users can further zoom with browser Ctrl/Cmd +/-
 * Text layer is left untouched - search highlights are rendered as overlays
 */
const PDFPageMemo = memo(({
  pageNumber,
  onLoadSuccess,
  width,
  height,
  searchQuery,
  isBrokenPage,
  docId,
}: {
  pageNumber: number;
  onLoadSuccess: (page: any) => void;
  width: number;
  height: number;
  searchQuery?: string;
  isBrokenPage?: boolean;
  docId?: string;
}) => {
  const [canvasRenderComplete, setCanvasRenderComplete] = useState(false);
  const [pageProxy, setPageProxy] = useState<any>(null);

  const handleLoadSuccess = useCallback((page: any) => {
    setPageProxy(page);
    setCanvasRenderComplete(false); // Reset for new page loads
    onLoadSuccess(page);
  }, [onLoadSuccess]);

  const handleRenderSuccess = useCallback(() => {
    setCanvasRenderComplete(true);
  }, []);

  // Calculate viewport scale: width / native page width (matches react-pdf's internal calc)
  const scale = pageProxy
    ? width / pageProxy.getViewport({ scale: 1 }).width
    : 1;

  return (
    <div
      style={{
        width: `${width}px`,
        height: `${height}px`,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <Page
        pageNumber={pageNumber}
        onLoadSuccess={handleLoadSuccess}
        onRenderSuccess={handleRenderSuccess}
        width={width}
        renderTextLayer={false}
        renderAnnotationLayer={true}
        canvasBackground="white"
      >
        {/* Text layer rendered as Page child so it inherits --scale-factor
            and positions correctly via inset:0 relative to the canvas */}
        {pageProxy && (
          <CustomTextLayer
            page={pageProxy}
            scale={scale}
            canvasRenderComplete={canvasRenderComplete}
            searchQuery={searchQuery}
            isBrokenPage={isBrokenPage}
            docId={docId}
            pageNumber={pageNumber}
          />
        )}
      </Page>
    </div>
  );
});
PDFPageMemo.displayName = 'PDFPageMemo';

/**
 * PDFViewerClient - Simplified PDF viewer with interactive table overlays
 *
 * Features:
 * - PDF rendering at 3x internal resolution for crisp, high-quality display
 * - Display scaled to normal viewing size (browser zoom for further adjustment)
 * - Browser native zoom (Ctrl/Cmd +/-)
 * - Continuous scrolling through all pages
 * - Scroll position persists automatically (component stays mounted via layout)
 * - Text highlighting and shareable links
 */

// Define row props type for react-window List
type PDFRowProps = {
  pageWidths: Record<number, number>;
  pageHeights: Record<number, number>;
  getPageLoadCallback: (pageNumber: number) => (page: any) => void;
  searchQuery: string;
};

interface SearchResult {
  pageNumber: number;
  text: string;
  context: string; // Text context around the match
  index: number;
  matchY?: number; // Y position of the match on the page (for scrolling)
}

export function PDFViewerClient({ fileUrl, filingId, searchQuery = '', searchTrigger = 0, onOutlineLoad, navigationRef, initialPage }: PDFViewerClientProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageWidths, setPageWidths] = useState<Record<number, number>>({});
  const [pageHeights, setPageHeights] = useState<Record<number, number>>({});
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<any>(null);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pdfDocumentRef = useRef<any>(null);

  // Track page height calculation status
  const [isCalculatingHeights, setIsCalculatingHeights] = useState(false);
  const [heightsReady, setHeightsReady] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0); // Increment to force List re-render

  // Store per-page scale factors for normalizing different page sizes to consistent width
  const [pageScaleFactors, setPageScaleFactors] = useState<Record<number, number>>({});
  const pageScaleFactorsRef = useRef<Record<number, number>>({});

  // Broken pages set — pages where PDF.js text extraction is gibberish
  const [brokenPages, setBrokenPages] = useState<Set<number>>(new Set());

  // Track current visible page for link sharing and page counter display
  const [currentVisiblePage, setCurrentVisiblePage] = useState(1);

  // Track which rows (pages) are currently rendered by virtualization
  const visibleRowsRef = useRef<{ startIndex: number; stopIndex: number }>({ startIndex: 0, stopIndex: 0 });

  // Track intersection ratios for each page to determine which is most visible
  const intersectionRatiosRef = useRef<Map<number, number>>(new Map());

  // Track if we just jumped to a page (to prevent counter from updating immediately)
  const jumpedToPageRef = useRef<boolean>(false);
  const jumpTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Link copy success state
  const [linkCopied, setLinkCopied] = useState(false);

  // Text selection popup state - enhanced with coordinate-based highlighting
  const [selectionPopup, setSelectionPopup] = useState<{
    show: boolean;
    x: number;
    y: number;
    text: string;
    pageNumber: number;
    rects: Array<{ x: number; y: number; width: number; height: number }>; // PDF coordinate rectangles
  }>({ show: false, x: 0, y: 0, text: '', pageNumber: 1, rects: [] });

  // Active highlight state - for rendering highlights from URL or selection
  const [activeHighlight, setActiveHighlight] = useState<HighlightData | null>(null);


  // Function to search all pages for matches
  const performSearch = useCallback(async () => {
    if (!searchQuery || searchQuery.length < 2 || !pdfDocumentRef.current) {
      setSearchResults([]);

      return;
    }

    const results: SearchResult[] = [];
    const searchLower = searchQuery.toLowerCase();

    try {
      // Search through all pages
      for (let pageNum = 1; pageNum <= (numPages || 0); pageNum++) {
        const page = await pdfDocumentRef.current.getPage(pageNum);
        const textContent = await page.getTextContent();

        // Build full page text with position tracking
        let fullText = '';
        const itemPositions: { start: number; end: number; item: any }[] = [];

        textContent.items.forEach((item: any) => {
          if (item.str) {
            const start = fullText.length;
            fullText += item.str + ' ';
            const end = fullText.length;
            itemPositions.push({ start, end, item });
          }
        });

        // Find all matches in the full text
        const fullTextLower = fullText.toLowerCase();
        let searchIndex = 0;

        while ((searchIndex = fullTextLower.indexOf(searchLower, searchIndex)) !== -1) {
          const matchEnd = searchIndex + searchLower.length;

          // Extract context around the match (150 chars before and after)
          const contextStart = Math.max(0, searchIndex - 150);
          const contextEnd = Math.min(fullText.length, matchEnd + 150);
          const context = fullText.substring(contextStart, contextEnd);

          // Find which item this match belongs to (for Y position)
          const matchItem = itemPositions.find(
            pos => searchIndex >= pos.start && searchIndex < pos.end
          );

          const matchY = matchItem?.item.transform?.[5];

          results.push({
            pageNumber: pageNum,
            text: fullText.substring(searchIndex, matchEnd),
            context: context,
            index: results.length,
            matchY: matchY,
          });

          searchIndex += searchLower.length;
        }
      }

      setSearchResults(results);

    } catch (error) {
      console.error('Search failed:', error);
    }
  }, [searchQuery, numPages]);

  // Trigger search when searchTrigger changes
  // Positive trigger: user-initiated search (show results modal)
  // Negative trigger: URL-initiated search (highlights only, no modal)
  useEffect(() => {
    if (searchTrigger !== 0) {
      performSearch().then(() => {
        if (searchTrigger > 0) {
          setShowSearchResults(true);
        }
      });
    }
  }, [searchTrigger, performSearch]);

  // Store page heights in a ref for stable getRowHeight function
  // Ref is updated synchronously when heights change (not via useEffect)
  const pageHeightsForRowHeight = useRef<Record<number, number>>({});

  // Helper to get the scrollable element from List ref
  const getScrollElement = useCallback(() => {
    // In react-window v2, the scrollable element is accessed via `.element`
    return listRef.current?.element || null;
  }, []);

  // Function to get row height - returns actual pre-calculated height
  // Stabilized without dependencies - uses ref to access current heights
  const getRowHeight = useCallback((index: number) => {
    const pageNum = index + 1;
    const actualHeight = pageHeightsForRowHeight.current[pageNum];
    const height = actualHeight ? actualHeight + 50 : ESTIMATED_PAGE_HEIGHT + 50;

    // Debug: Log height requests (throttled to avoid spam)
    if (pageNum % 10 === 0 || pageNum <= 5 || pageNum >= (numPages || 0) - 5) {
      // Debug log removed for production
    }

    return height;
  }, [numPages]);

  // Function to scroll to a specific match position
  const scrollToMatch = useCallback((result: SearchResult) => {
    if (!listRef.current) return;

    // Scrolling to search result

    const targetIndex = result.pageNumber - 1;

    // Calculate scroll position manually
    let scrollTop = 0;
    for (let i = 0; i < targetIndex; i++) {
      const rowHeight = getRowHeight(i);
      scrollTop += rowHeight;
    }

    // Then, if we have the Y position, fine-tune the scroll
    if (result.matchY !== undefined) {
      const matchY = result.matchY; // Store in a const to satisfy TypeScript

      // Add the Y position within the current page (convert from PDF coordinates)
      // matchY is in PDF points from bottom (PDF.js transform[5])
      // currentPageHeight is in display pixels (at DISPLAY_SCALE)
      // We need to scale matchY by the same factor and flip from bottom-to-top
      // CRITICAL: Use pageHeightsForRowHeight ref which has the actual calculated heights
      const currentPageHeight = pageHeightsForRowHeight.current[result.pageNumber] || ESTIMATED_PAGE_HEIGHT;
      const matchYScaled = matchY * DISPLAY_SCALE; // Scale to display coordinates
      const yOffsetInPage = currentPageHeight - matchYScaled; // Flip from bottom-origin to top-origin

      scrollTop += yOffsetInPage;

      // Center the match vertically if possible
      const scrollElement = getScrollElement();
      if (scrollElement) {
        const containerHeight = scrollElement.clientHeight;
        scrollTop = Math.max(0, scrollTop - (containerHeight / 2));
      }
    }

    // Enable jump protection to prevent scroll handler from overriding
    jumpedToPageRef.current = true;

    // Scroll the element directly
    const scrollElement = getScrollElement();
    if (scrollElement) {
      scrollElement.scrollTop = scrollTop;
    }

    // Update page counter immediately
    setCurrentVisiblePage(result.pageNumber);

    // Disable jump protection after scroll completes
    setTimeout(() => {
      jumpedToPageRef.current = false;
    }, 1000);
  }, [pageHeights, getRowHeight, getScrollElement]);

  // Track container size for virtualization
  useEffect(() => {
    if (!containerRef.current) return;

    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    // Initial size
    updateSize();

    // Listen for resize
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Track visible rows using react-window List's onRowsRendered callback
  const handleRowsRendered = useCallback(({ startIndex, stopIndex }: { startIndex: number; stopIndex: number }) => {
    // Update ref with current visible range (for validation in text selection)
    visibleRowsRef.current = {
      startIndex,
      stopIndex,
    };

    // Debug: Log rendered page range to diagnose duplicate rendering
    const pageRange = Array.from({ length: stopIndex - startIndex + 1 }, (_, i) => startIndex + i + 1);
    // Debug log removed for production

    // Note: Page counter is now updated by IntersectionObserver, not here
  }, []);

  // Set up scroll listener to update page counter based on scroll position
  useEffect(() => {
    if (!numPages || !heightsReady) {
      return;
    }

    let rafId: number | null = null;
    let listElement: HTMLElement | null = null;
    let retryTimeout: NodeJS.Timeout | null = null;

    const setupScrollHandler = () => {
      listElement = getScrollElement();

      if (!listElement) {
        // Retry in 50ms
        // Retry after List component has had a chance to mount
        retryTimeout = setTimeout(setupScrollHandler, 50);
        return;
      }

      // Page counter ready

      const handleScroll = () => {
        if (!listElement) return;

        // Use requestAnimationFrame to throttle updates to once per frame
        if (rafId) return;

        rafId = requestAnimationFrame(() => {
          rafId = null;

          // Don't update if we just jumped to a page
          if (jumpedToPageRef.current) {
            return;
          }

          if (!listElement) return;

          const scrollTop = listElement.scrollTop;
          const viewportHeight = listElement.clientHeight;
          const viewportCenter = scrollTop + (viewportHeight / 2);

          // Find which page contains the viewport center
          let accumulatedHeight = 0;
          let pageAtCenter = 1;

          for (let i = 0; i < numPages; i++) {
            const pageHeight = getRowHeight(i);
            if (viewportCenter >= accumulatedHeight && viewportCenter < accumulatedHeight + pageHeight) {
              pageAtCenter = i + 1;
              break;
            }
            accumulatedHeight += pageHeight;
          }

          setCurrentVisiblePage(prev => {
            if (pageAtCenter !== prev) {
              return pageAtCenter;
            }
            return prev;
          });
        });
      };

      // Initial update
      handleScroll();

      // Listen for scroll events
      listElement.addEventListener('scroll', handleScroll, { passive: true });

      // Return cleanup function for this specific handler
      return () => {
        if (listElement) {
          listElement.removeEventListener('scroll', handleScroll);
        }
      };
    };

    // Start setup
    const cleanupHandler = setupScrollHandler();

    return () => {
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
      if (cleanupHandler) {
        cleanupHandler();
      }
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [numPages, heightsReady, getRowHeight, getScrollElement]);

  // Set up Intersection Observer to track page visibility (for debugging, not used for page counter anymore)
  useEffect(() => {
    const observerOptions = {
      root: getScrollElement() || null,
      rootMargin: '0px',
      threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const pageElement = entry.target as HTMLElement;
        const pageNum = pageElement.getAttribute('data-page-number');

        if (pageNum) {
          const pageNumber = parseInt(pageNum, 10);

          if (entry.isIntersecting) {
            // Update intersection ratio for this page
            intersectionRatiosRef.current.set(pageNumber, entry.intersectionRatio);
          } else {
            // Page is no longer visible, remove from tracking
            intersectionRatiosRef.current.delete(pageNumber);
            // Don't log every exit - too verbose
          }
        }
      });
    }, observerOptions);

    // Observe all page elements
    const observePages = () => {
      const pageElements = document.querySelectorAll('[data-page-number]');
      pageElements.forEach((el) => observer.observe(el));
    };

    // Initial observation
    observePages();

    // Re-observe when pages are rendered (use a MutationObserver)
    const mutationObserver = new MutationObserver(() => {
      observePages();
    });

    const listElement = getScrollElement();
    if (listElement) {
      mutationObserver.observe(listElement, {
        childList: true,
        subtree: true,
      });
    }

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, [getScrollElement]);

  async function onDocumentLoadSuccess(pdf: any) {
    setNumPages(pdf.numPages);
    pdfDocumentRef.current = pdf;

    // Extract PDF outline (table of contents)
    try {
      const outline = await pdf.getOutline();
      if (outline && onOutlineLoad) {
        onOutlineLoad(outline);
      }
    } catch (error) {
      console.error('Failed to extract outline:', error);
    }

    // Fetch document metadata to identify broken pages (non-blocking)
    if (filingId) {
      documentOcrApi.getMetadata(filingId).then((meta) => {
        if (meta.broken_pages && meta.broken_pages.length > 0) {
          setBrokenPages(new Set(meta.broken_pages));
        }
      }).catch((err) => {
        // Non-fatal: if metadata fetch fails, all pages use native text layer
        console.warn('Failed to fetch document metadata:', err);
      });
    }

    // Pre-calculate all page heights for accurate scroll positioning
    setIsCalculatingHeights(true);
    const startTime = performance.now();

    try {
      const heights: Record<number, number> = {};
      const widths: Record<number, number> = {};
      const scaleFactors: Record<number, number> = {};

      // Fetch page dimensions in parallel (fast - just metadata, no rendering)
      // CRITICAL: Normalize all pages to consistent width for uniform display
      // - First pass: get raw dimensions at DISPLAY_SCALE
      // - Second pass: calculate scale factor to fit TARGET_DISPLAY_WIDTH
      const rawDimensions: { pageNum: number; width: number; height: number }[] = [];
      const pagePromises = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        pagePromises.push(
          pdf.getPage(i).then((page: any) => {
            const viewport = page.getViewport({ scale: DISPLAY_SCALE });
            rawDimensions.push({
              pageNum: i,
              width: viewport.width,
              height: viewport.height,
            });
          })
        );
      }

      await Promise.all(pagePromises);

      // Sort by page number to ensure correct order
      rawDimensions.sort((a, b) => a.pageNum - b.pageNum);

      // Calculate normalized dimensions - scale each page to fit TARGET_DISPLAY_WIDTH
      for (const dim of rawDimensions) {
        const scaleFactor = TARGET_DISPLAY_WIDTH / dim.width;
        scaleFactors[dim.pageNum] = scaleFactor;
        widths[dim.pageNum] = TARGET_DISPLAY_WIDTH; // All pages get same width
        heights[dim.pageNum] = dim.height * scaleFactor; // Height scaled proportionally

      }

      const endTime = performance.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      // Heights calculated

      setPageHeights(heights);
      setPageWidths(widths);
      setPageScaleFactors(scaleFactors);
      pageScaleFactorsRef.current = scaleFactors;

      // CRITICAL: Update ref SYNCHRONOUSLY before List remount
      // This ensures getRowHeight reads actual heights, not estimates
      pageHeightsForRowHeight.current = heights;

      // CRITICAL: Invalidate react-window's layout cache after updating heights
      // Must wait for state update, then force recalculation with new heights
      setTimeout(() => {
        try {
          if (listRef.current && typeof listRef.current.resetAfterIndex === 'function') {
            listRef.current.resetAfterIndex(0);
          }
        } catch (error) {
          console.error('Failed to reset layout cache:', error);
        }

        // Always mark as ready, even if resetAfterIndex failed
        setHeightsReady(true);
        setIsCalculatingHeights(false);

        // Force List to re-render with new heights by changing key
        setLayoutVersion(v => v + 1);
      }, 50);
    } catch (error) {
      console.error('Failed to pre-calculate page heights:', error);
      setIsCalculatingHeights(false);
    }
  }

  // Generate shareable link with coordinate-based highlight data
  const handleCopyLink = useCallback(() => {
    const baseUrl = window.location.origin + pathname;

    // Encode highlight rectangles
    const encoded = encodeHighlight(selectionPopup.pageNumber, selectionPopup.rects);

    if (!encoded) {
      console.error('Failed to encode highlight');
      return;
    }

    const shareUrl = `${baseUrl}?h=${encoded}`;

    // Copy to clipboard using fallback-enabled helper
    copyToClipboard(shareUrl).then((success) => {
      if (success) {
        // Show success feedback
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
      } else {
        console.error('Failed to copy link');
      }
    });
  }, [selectionPopup, pathname]);

  // Handle incoming URL parameters on mount - coordinate-based highlighting
  useEffect(() => {
    const highlightParam = searchParams.get('h');

    if (!highlightParam) {
      return;
    }

    // Decode highlight data
    const highlightData = decodeHighlight(highlightParam);

    if (!highlightData) {
      console.error('Failed to decode highlight from URL');
      return;
    }

    // Set highlight data for rendering
    setActiveHighlight(highlightData);

    // Wait for PDF to load and heights to be calculated, then scroll to page
    const scrollToHighlight = (attemptNumber = 1, maxAttempts = 20) => {
      if (!listRef.current || !heightsReady || !numPages) {
        if (attemptNumber < maxAttempts) {
          setTimeout(() => scrollToHighlight(attemptNumber + 1), 300);
        }
        return;
      }

      const targetIndex = highlightData.pageNumber - 1;

      // Calculate scroll position
      let scrollTop = 0;
      for (let i = 0; i < targetIndex; i++) {
        const rowHeight = getRowHeight(i);
        scrollTop += rowHeight;
      }

      // Add first rect's Y position for more precise positioning
      if (highlightData.rects.length > 0) {
        const firstRect = highlightData.rects[0];
        const hlPageScale = pageScaleFactorsRef.current[highlightData.pageNumber] || 1.0;
        scrollTop += firstRect.y * DISPLAY_SCALE * hlPageScale;
      }

      // Set jump protection flag to prevent scroll handler from updating page counter
      jumpedToPageRef.current = true;
      if (jumpTimerRef.current) {
        clearTimeout(jumpTimerRef.current);
      }
      jumpTimerRef.current = setTimeout(() => {
        jumpedToPageRef.current = false;
        jumpTimerRef.current = null;
      }, 2000);

      // Scroll to position
      const scrollElement = getScrollElement();
      if (scrollElement) {
        scrollElement.scrollTop = scrollTop;
        setCurrentVisiblePage(highlightData.pageNumber);
      }
    };

    const timer = setTimeout(() => scrollToHighlight(), 100);

    return () => clearTimeout(timer);
  }, [searchParams, numPages, heightsReady, getRowHeight, getScrollElement]);

  // Handle initial page navigation from URL parameter
  useEffect(() => {
    if (!initialPage || initialPage < 1) return;
    if (!numPages || !heightsReady) return;
    if (initialPage > numPages) return;

    // Wait for PDF to load and heights to be calculated, then scroll to page
    const scrollToInitialPage = (attemptNumber = 1, maxAttempts = 20) => {
      if (!listRef.current || !heightsReady || !numPages) {
        if (attemptNumber < maxAttempts) {
          setTimeout(() => scrollToInitialPage(attemptNumber + 1), 300);
        }
        return;
      }

      const targetIndex = initialPage - 1;

      // Calculate scroll position
      let scrollTop = 0;
      for (let i = 0; i < targetIndex; i++) {
        const rowHeight = getRowHeight(i);
        scrollTop += rowHeight;
      }

      // Set jump protection flag to prevent scroll handler from updating page counter
      jumpedToPageRef.current = true;
      if (jumpTimerRef.current) {
        clearTimeout(jumpTimerRef.current);
      }
      jumpTimerRef.current = setTimeout(() => {
        jumpedToPageRef.current = false;
        jumpTimerRef.current = null;
      }, 2000);

      // Scroll to position
      const scrollElement = getScrollElement();
      if (scrollElement) {
        scrollElement.scrollTop = scrollTop;
        setCurrentVisiblePage(initialPage);
      }
    };

    const timer = setTimeout(() => scrollToInitialPage(), 100);

    return () => clearTimeout(timer);
  }, [initialPage, numPages, heightsReady, getRowHeight, getScrollElement]);

  // Handle text selection popup - enhanced to capture page and Y position
  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();

      if (selectedText && selectedText.length > 0 && selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);

        // Get all rectangles for multi-line selections
        const clientRects = Array.from(range.getClientRects());

        if (clientRects.length > 0) {
          // Find which page the selection is on
          let pageNumber = currentVisiblePage;

          // Try to find the exact page element containing the selection
          const startContainer = range.startContainer;
          const parentElement = (startContainer.nodeType === Node.ELEMENT_NODE
            ? startContainer as HTMLElement
            : startContainer.parentElement);
          const pageElement = parentElement?.closest('[data-page-number]') as HTMLElement;

          if (pageElement) {
            const pageNum = pageElement.getAttribute('data-page-number');
            if (pageNum) {
              pageNumber = parseInt(pageNum, 10);

              // Cross-validate with visible rows to ensure page is actually rendered
              const pageIndex = pageNumber - 1; // Convert to 0-indexed
              const isPageVisible = pageIndex >= visibleRowsRef.current.startIndex &&
                                    pageIndex <= visibleRowsRef.current.stopIndex;

              if (!isPageVisible) {
                // Page from DOM not in visible range, using visible page instead
                pageNumber = currentVisiblePage;
              }
            }

            // Convert all client rectangles to 1x PDF coordinates
            const pageRect = pageElement.getBoundingClientRect();
            const pageScale = pageScaleFactorsRef.current[pageNumber] || 1.0;
            const actualScale = DISPLAY_SCALE * pageScale;
            const pdfRects = clientRects.map(rect => {
              const relativeX = rect.left - pageRect.left;
              const relativeY = rect.top - pageRect.top;

              // Convert from screen coordinates to 1x PDF coordinates
              // Screen pixels are at actualScale (DISPLAY_SCALE * pageScale)
              return {
                x: relativeX / actualScale,
                y: relativeY / actualScale,
                width: rect.width / actualScale,
                height: rect.height / actualScale
              };
            });

            // Use first rect for popup positioning
            const firstRect = clientRects[0];
            setSelectionPopup({
              show: true,
              x: firstRect.left + firstRect.width / 2,
              y: firstRect.top - 10, // Position above selection
              text: selectedText,
              pageNumber: pageNumber,
              rects: pdfRects,
            });
          }
        }
      } else {
        setSelectionPopup({ show: false, x: 0, y: 0, text: '', pageNumber: 1, rects: [] });
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [currentVisiblePage]);

  // Navigation handler for TOC - resolves destination to page number and position
  const navigateToDestination = useCallback(async (dest: any) => {
    if (!pdfDocumentRef.current || !listRef.current) {
      console.error('Missing refs');
      return;
    }

    const totalPages = pdfDocumentRef.current.numPages;
    // TOC Navigation

    try {
      let pageNumber: number | undefined;
      let destArray: any[] | null = null;

      // If dest is a string (named destination), resolve it
      if (typeof dest === 'string') {
        const destination = await pdfDocumentRef.current.getDestination(dest);
        if (destination) {
          const pageRef = destination[0];
          pageNumber = await pdfDocumentRef.current.getPageIndex(pageRef) + 1;
          destArray = destination;
        } else {
          console.error('Could not resolve named destination');
          return;
        }
      }
      // If dest is an array (explicit destination)
      else if (Array.isArray(dest)) {
        const pageRef = dest[0];
        const pageIndex = await pdfDocumentRef.current.getPageIndex(pageRef);
        pageNumber = pageIndex + 1;
        destArray = dest;
      } else {
        console.error('Unknown dest type');
        return;
      }

      if (pageNumber !== undefined && pageNumber > 0 && pageNumber - 1 < totalPages) {
        const targetIndex = pageNumber - 1;

        // Calculate scroll position to top of page
        let scrollTop = 0;
        for (let i = 0; i < targetIndex; i++) {
          const rowHeight = getRowHeight(i);
          scrollTop += rowHeight;
        }

        // Extract Y position from destination if available
        // PDF destination format: [pageRef, name, x, y, zoom]
        // name can be 'XYZ', 'FitH', 'FitV', etc.
        // For 'XYZ': dest = [pageRef, 'XYZ', x, y, zoom]
        // For 'FitH': dest = [pageRef, 'FitH', top]
        if (destArray && destArray.length >= 3) {
          const destName = destArray[1]?.name || destArray[1];

          if (destName === 'XYZ' && destArray.length >= 4) {
            // Y coordinate in PDF points (from bottom)
            const destY = destArray[3];

            // null means "keep current position" - we'll ignore it and just go to top of page
            if (destY !== null && destY !== undefined) {
              // Convert Y from PDF coordinates to display coordinates
              // CRITICAL: Use pageHeightsForRowHeight ref which has the actual calculated heights
              const currentPageHeight = pageHeightsForRowHeight.current[pageNumber] || ESTIMATED_PAGE_HEIGHT;

              const destYScaled = destY * DISPLAY_SCALE; // Scale to display pixels
              const yOffsetInPage = currentPageHeight - destYScaled; // Flip from bottom-origin to top-origin

              scrollTop += yOffsetInPage;
            }
          } else if (destName === 'FitH' && destArray.length >= 3) {
            // FitH has top position at index 2
            const destY = destArray[2];

            if (destY !== null && destY !== undefined) {
              // CRITICAL: Use pageHeightsForRowHeight ref which has the actual calculated heights
              const currentPageHeight = pageHeightsForRowHeight.current[pageNumber] || ESTIMATED_PAGE_HEIGHT;

              const destYScaled = destY * DISPLAY_SCALE;
              const yOffsetInPage = currentPageHeight - destYScaled;

              scrollTop += yOffsetInPage;
            }
          }
        }

        // Enable jump protection to prevent scroll handler from overriding
        jumpedToPageRef.current = true;

        // Scroll the element directly
        const scrollElement = getScrollElement();
        if (scrollElement) {
          scrollElement.scrollTop = scrollTop;
        } else {
          console.error('Scroll element is null');
        }

        // Update page counter immediately
        setCurrentVisiblePage(pageNumber);

        // Disable jump protection after scroll completes
        setTimeout(() => {
          jumpedToPageRef.current = false;
        }, 1000);
      } else {
        console.error('Invalid page or out of range:', pageNumber, 'totalPages:', totalPages);
      }
    } catch (error) {
      console.error('Navigation failed:', error);
    }
  }, [getRowHeight, getScrollElement, pageHeights]);

  // Expose navigation function via ref
  useEffect(() => {
    if (navigationRef) {
      navigationRef.current = navigateToDestination;
    }
  }, [navigationRef, navigateToDestination]);

  // Handle internal PDF link clicks (table of contents, etc.)
  const onItemClick = useCallback(async (item: any) => {
    // Internal PDF links have a 'dest' property that needs to be resolved
    // Use the same navigation logic as TOC
    if (item.dest) {
      await navigateToDestination(item.dest);
    } else if (item.pageNumber) {
      // Fallback to direct page number if available
      const pageNumber = typeof item.pageNumber === 'string' ? parseInt(item.pageNumber, 10) : item.pageNumber;
      const totalPages = pdfDocumentRef.current?.numPages;

      if (listRef.current && pdfDocumentRef.current && pageNumber > 0 && totalPages && pageNumber - 1 < totalPages) {
        const targetIndex = pageNumber - 1;

        // Calculate scroll position manually
        let scrollTop = 0;
        for (let i = 0; i < targetIndex; i++) {
          const rowHeight = getRowHeight(i);
          scrollTop += rowHeight;
        }

        // Enable jump protection
        jumpedToPageRef.current = true;

        // Scroll the element directly
        const scrollElement = getScrollElement();
        if (scrollElement) {
          scrollElement.scrollTop = scrollTop;
        }

        // Update page counter
        setCurrentVisiblePage(pageNumber);

        // Disable jump protection after scroll completes
        setTimeout(() => {
          jumpedToPageRef.current = false;
        }, 1000);
      }
    } else {
      console.error('PDF Internal Link - No dest or pageNumber found in item:', item);
    }
  }, [getRowHeight, navigateToDestination, getScrollElement]);

  // Create stable callbacks for page load success - one per page number
  // Note: We no longer update dimensions here because they are pre-calculated
  // with normalization during onDocumentLoadSuccess. Updating here would
  // overwrite the normalized values with raw page dimensions.
  const pageLoadCallbacks = useRef<Map<number, (page: any) => void>>(new Map());

  const getPageLoadCallback = useCallback((pageNumber: number) => {
    if (!pageLoadCallbacks.current.has(pageNumber)) {
      pageLoadCallbacks.current.set(pageNumber, (_page: any) => {
        // Dimensions are pre-calculated with normalization in onDocumentLoadSuccess
        // No need to update here - just a placeholder for the onLoadSuccess callback
      });
    }
    return pageLoadCallbacks.current.get(pageNumber)!;
  }, []);

  // Row component - receives data through rowProps to allow efficient updates
  // This is a stable component reference that react-window can optimize
  // Note: key prop is handled by List's itemKey prop, not here
  const Row = useCallback((props: {
    index: number;
    style: React.CSSProperties;
    ariaAttributes: any;
    pageWidths: Record<number, number>;
    pageHeights: Record<number, number>;
    pageScaleFactors: Record<number, number>;
    getPageLoadCallback: (pageNumber: number) => (page: any) => void;
    searchQuery: string;
    activeHighlight: HighlightData | null;
    brokenPages: Set<number>;
    docId?: string;
  }) => {
    const pageNum = props.index + 1;

    // Use pre-calculated dimensions (already normalized), fall back to estimated if not available
    const pageWidth = props.pageWidths[pageNum] || ESTIMATED_PAGE_WIDTH;
    const pageHeight = props.pageHeights[pageNum] || ESTIMATED_PAGE_HEIGHT;
    // Get per-page scale factor (for normalizing different page sizes)
    const pageScale = props.pageScaleFactors[pageNum] || 1.0;

    // Check if this page has the active highlight
    const pageHighlight = props.activeHighlight?.pageNumber === pageNum ? props.activeHighlight : null;

    // Check if this page has broken text extraction
    const isBrokenPage = props.brokenPages.has(pageNum);

    return (
      <div style={{ ...props.style, display: 'flex', justifyContent: 'center' }} {...props.ariaAttributes}>
        <div className="relative shadow-lg mb-4" style={{ width: 'fit-content' }}>
          <div style={{ position: 'relative', display: 'inline-block' }} data-page-number={pageNum}>
            <PDFPageMemo
              pageNumber={pageNum}
              onLoadSuccess={props.getPageLoadCallback(pageNum)}
              width={pageWidth}
              height={pageHeight}
              searchQuery={props.searchQuery}
              isBrokenPage={isBrokenPage}
              docId={props.docId}
            />

            {/* URL-based highlight overlay (coordinate-based, from shared links) */}
            {pageWidth > 0 && pageHeight > 0 && pageHighlight && (
              <HighlightOverlay
                rects={pageHighlight.rects}
                pageWidth={pageWidth}
                pageHeight={pageHeight}
                renderScale={DISPLAY_SCALE * pageScale}
              />
            )}
          </div>
        </div>
      </div>
    );
  }, []);

  // Memoize rowProps to prevent object identity changes on every render
  // This prevents react-window from re-rendering all rows unnecessarily
  // TODO: Fix react-window type - it expects index, style, ariaAttributes but these are
  // automatically provided by List component. This is a false positive type error.
  const rowProps = useMemo(() => ({
    pageWidths,
    pageHeights,
    pageScaleFactors,
    getPageLoadCallback,
    searchQuery,
    activeHighlight,
    brokenPages,
    docId: filingId,
  }), [pageWidths, pageHeights, pageScaleFactors, getPageLoadCallback, searchQuery, activeHighlight, brokenPages, filingId]) as any;

  return (
    <div className="h-full w-full bg-gray-100">
      {/* PDF Viewer - Virtualized Scrolling */}
      <div ref={scrollContainerRef} className="h-full w-full overflow-hidden bg-gray-100">
        <div ref={containerRef} className="h-full w-full">
        <Document
          file={fileUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          onItemClick={onItemClick}
          onLoadError={(error) => {
            console.error('❌ PDF Load Error:', error);
            console.error('❌ Attempted to load:', fileUrl);
          }}
          loading={
            <div className="flex items-center justify-center h-96">
              <div className="text-center">
                <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-200 border-t-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Loading PDF...</p>
                <p className="text-xs text-gray-500 mt-2">{fileUrl}</p>
              </div>
            </div>
          }
          error={
            <div className="flex items-center justify-center h-96">
              <div className="text-center text-red-600">
                <p className="font-semibold mb-2">Failed to load PDF</p>
                <p className="text-sm text-gray-600 mt-2">{fileUrl}</p>
                <p className="text-xs text-gray-500 mt-4">Check browser console for details</p>
              </div>
            </div>
          }
        >
          {numPages && containerSize.height > 0 && heightsReady && (
            <List
              key={`pdf-list-${layoutVersion}`}
              listRef={listRef}
              rowComponent={Row}
              rowCount={numPages}
              rowHeight={getRowHeight}
              rowProps={rowProps}
              onRowsRendered={handleRowsRendered}
              style={{ height: containerSize.height, width: containerSize.width }}
              overscanCount={2}
            />
          )}
        </Document>
        </div>
      </div>

      {/* Height Calculation Loading Overlay */}
      {isCalculatingHeights && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[500]">
          <div className="bg-white rounded-lg shadow-2xl p-8 max-w-md">
            <div className="text-center">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-200 border-t-blue-600 mx-auto mb-4"></div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Calculating Page Layout...</h3>
              <p className="text-sm text-gray-600">
                Pre-calculating page heights for accurate positioning
              </p>
              <p className="text-xs text-gray-500 mt-2">
                {numPages} pages • This takes ~1 second
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Search Results Modal */}
      {showSearchResults && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200]"
          onClick={() => setShowSearchResults(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[80vh] flex flex-col m-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                Search Results: "{searchQuery}" ({searchResults.length} found)
              </h3>
              <button
                onClick={() => setShowSearchResults(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Results List */}
            <div className="flex-1 overflow-y-auto p-4">
              {searchResults.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  No results found.
                </div>
              ) : (
                <div className="space-y-3">
                  {searchResults.map((result, idx) => {
                    // Highlight the match in the context
                    const contextLower = result.context.toLowerCase();
                    const matchIndex = contextLower.indexOf(searchQuery.toLowerCase());

                    let beforeMatch = result.context;
                    let matchText = '';
                    let afterMatch = '';

                    if (matchIndex !== -1) {
                      beforeMatch = result.context.substring(0, matchIndex);
                      matchText = result.context.substring(matchIndex, matchIndex + searchQuery.length);
                      afterMatch = result.context.substring(matchIndex + searchQuery.length);
                    }

                    return (
                      <button
                        key={idx}
                        onClick={() => {
                          scrollToMatch(result);
                          setShowSearchResults(false);
                        }}
                        className="w-full text-left p-4 bg-white hover:bg-blue-50 rounded-lg transition-colors border border-gray-300 hover:border-blue-400 shadow-sm hover:shadow-md"
                      >
                        <div className="flex flex-col gap-2">
                          {/* Page Number Badge */}
                          <div className="flex items-center justify-between mb-2">
                            <div className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-bold">
                              Page {result.pageNumber}
                            </div>
                            <div className="text-xs text-gray-500">
                              Click to navigate →
                            </div>
                          </div>

                          {/* Text Context with Highlighted Match */}
                          <div className="text-sm text-gray-700 leading-relaxed">
                            <span>{beforeMatch}</span>
                            <span className="bg-yellow-300 font-semibold text-gray-900 px-0.5">
                              {matchText}
                            </span>
                            <span>{afterMatch}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Text Selection Popup */}
      {selectionPopup.show && (
        <div
          className="fixed z-[300] bg-white rounded-lg shadow-xl border border-gray-200 px-2 py-1 flex items-center gap-2"
          style={{
            left: `${selectionPopup.x}px`,
            top: `${selectionPopup.y}px`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          {/* Copy Button */}
          <button
            onClick={() => {
              copyToClipboard(selectionPopup.text);
            }}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 rounded transition-colors"
            title="Copy text"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Copy
          </button>

          {/* Copy Link Button */}
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 rounded transition-colors"
            title="Copy shareable link"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Copy Link
          </button>

        </div>
      )}

      {/* Link Copied Toast */}
      {linkCopied && (
        <div
          className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-[400] bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="font-medium">Link copied to clipboard!</span>
        </div>
      )}

      {/* Page Counter */}
      {numPages && (
        <div className="fixed bottom-6 right-6 z-[250] bg-gray-800 bg-opacity-90 text-white px-4 py-2 rounded-lg shadow-lg">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="font-medium text-sm">
              Page {currentVisiblePage} of {numPages}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default PDFViewerClient;
