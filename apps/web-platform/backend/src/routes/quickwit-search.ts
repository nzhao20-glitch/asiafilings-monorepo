import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

const QUICKWIT_URL = 'http://54.46.79.126:7280/api/v1/filings/search';
const QUICKWIT_TIMEOUT = 60000;
const PAGE_SIZE = 500;
const MAX_TOTAL_HITS = 10000;

interface QuickwitSearchBody {
  query: string;
  company_id?: string;
  exchange?: string;
}

export default async function quickwitSearchRoutes(fastify: FastifyInstance) {
  fastify.post('/quickwit-search', async (request: FastifyRequest<{ Body: QuickwitSearchBody }>, reply: FastifyReply) => {
    const { query, company_id } = request.body;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_QUERY', message: 'Query is required' },
      });
    }

    // Build Quickwit query string — scope phrase query to text field (title lacks positions)
    let quickwitQuery = `text:"${query.trim()}"`;
    if (company_id) {
      quickwitQuery = `company_id:${company_id} AND ${quickwitQuery}`;
    }

    try {
      // Paginate through Quickwit results
      const allHits: { hit: any; snippet: string }[] = [];
      let totalNumHits = 0;
      let offset = 0;

      while (offset < MAX_TOTAL_HITS) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), QUICKWIT_TIMEOUT);

        const params = new URLSearchParams({
          query: quickwitQuery,
          max_hits: String(PAGE_SIZE),
          start_offset: String(offset),
          snippet_fields: 'text',
          sort_by_field: '-filing_date',
        });

        let response: Response;
        try {
          response = await fetch(`${QUICKWIT_URL}?${params}`, {
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          fastify.log.error(`Quickwit returned ${response.status}: ${errorText}`);
          return reply.status(502).send({
            success: false,
            error: { code: 'QUICKWIT_ERROR', message: 'Search engine returned an error' },
          });
        }

        const data = await response.json();
        totalNumHits = data.num_hits ?? 0;

        if (data.hits && Array.isArray(data.hits)) {
          const snippets = data.snippets || [];
          for (let i = 0; i < data.hits.length; i++) {
            const snippetText = snippets[i]?.text?.[0] || '';
            allHits.push({ hit: data.hits[i], snippet: snippetText });
          }
        }

        // Stop if we've fetched all hits or this page returned fewer than PAGE_SIZE
        const hitsReturned = data.hits?.length ?? 0;
        if (hitsReturned < PAGE_SIZE || allHits.length >= totalNumHits) {
          break;
        }

        offset += PAGE_SIZE;
      }

      fastify.log.info(`Quickwit: fetched ${allHits.length} / ${totalNumHits} hits in ${Math.ceil(allHits.length / PAGE_SIZE)} pages`);

      // Deduplicate hits to filing level
      const queryLower = query.trim().toLowerCase();
      const filingMap = new Map<string, {
        hit: any;
        matched_pages: { page_number: number; snippet: string; match_count: number }[];
      }>();

      for (const { hit, snippet: rawSnippet } of allHits) {
        // Strip <b> tags from Quickwit snippet
        const snippet = rawSnippet
          ? rawSnippet.replace(/<\/?b>/g, '')
          : '';

        // Count occurrences from full text
        const text: string = hit.text || '';
        const textLower = text.toLowerCase();
        let matchCount = 0;
        let searchPos = 0;
        while (searchPos < textLower.length) {
          const idx = textLower.indexOf(queryLower, searchPos);
          if (idx === -1) break;
          matchCount++;
          searchPos = idx + queryLower.length;
        }

        if (!filingMap.has(hit.document_id)) {
          filingMap.set(hit.document_id, { hit, matched_pages: [] });
        }

        const entry = filingMap.get(hit.document_id)!;
        // Skip duplicate pages (can occur if the same JSONL was ingested twice)
        if (!entry.matched_pages.some(p => p.page_number === hit.page_number)) {
          entry.matched_pages.push({
            page_number: hit.page_number,
            snippet,
            match_count: matchCount,
          });
        }
      }

      // Build filing-level results
      const results = Array.from(filingMap.values()).map(({ hit, matched_pages }) => {
        matched_pages.sort((a, b) => a.page_number - b.page_number);
        return {
          document_id: hit.document_id,
          total_pages: hit.total_pages,
          s3_key: hit.s3_key,
          exchange: hit.exchange,
          company_id: hit.company_id,
          company_name: hit.company_name,
          filing_date: hit.filing_date,
          filing_type: hit.filing_type,
          title: hit.title,
          matched_pages,
        };
      });

      return reply.send({ num_hits: totalNumHits, results });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        fastify.log.error('Quickwit request timed out');
        return reply.status(502).send({
          success: false,
          error: { code: 'QUICKWIT_TIMEOUT', message: 'Search engine timed out' },
        });
      }

      fastify.log.error(`Quickwit request failed: ${err.message}`);
      return reply.status(502).send({
        success: false,
        error: { code: 'QUICKWIT_UNREACHABLE', message: 'Search engine is unreachable' },
      });
    }
  });
}
