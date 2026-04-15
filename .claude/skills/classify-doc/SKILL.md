---
name: classify-doc
description: Use when building, modifying, or debugging the AI document classification pipeline — Claude API prompt, OCR extraction, confidence scoring, or the /api/classify-document route.
---

# Document Classification Pipeline

## Pipeline Flow

```
File Upload (POST /api/portal/upload)
  ↓
lib/ocr/extract.ts
  ├── PDF      → pdf-parse → raw text
  └── Image    → Tesseract.js → raw text
  ↓
POST /api/classify-document
  ├── Input:  { text: string, filename: string, mimeType: string }
  ├── Claude: claude-sonnet-4-20250514
  └── Output: ClassificationResult
  ↓
UPDATE documents SET ai_doc_type=..., ai_financial_years=..., ai_confidence=..., status=...
```

## ClassificationResult Type

```typescript
// src/types/app.ts
interface ClassificationResult {
  docType: string;               // One of DOCUMENT_TYPES values from constants.ts
  financialYears: string[];      // e.g. ["FY2022", "FY2023", "FY2024"]
  confidence: number;            // 0.0–1.0
  formatWarning: string | null;  // e.g. "ICA received as PDF — CSV preferred"
  reasoning: string;             // Claude's explanation (for debugging)
  rawResponse: Record<string, unknown>;
}
```

## Confidence Thresholds

| Confidence | DB status | UI |
|---|---|---|
| ≥ 0.85 | `classified` | Green badge |
| 0.60–0.84 | `classified` | Amber badge |
| < 0.60 | `needs_review`, docType = `unknown` | Red badge |

## Prompt Pattern (lib/ai/prompts.ts)

The system prompt must:
1. List all 8 canonical document type DB values (import from `constants.ts`)
2. Instruct Claude to detect financial years in "FYXXXX" format
3. Define the confidence scoring rubric (0.0–1.0)
4. Require JSON-only output — no prose
5. Include format warning logic (e.g. if ICA arrives as PDF)

Claude response must be valid JSON matching `ClassificationResult`. Use `JSON.parse()` in a try/catch. If parse fails, set `status = 'needs_review'`.

## Security Checklist for /api/classify-document

- [ ] Check `x-internal-secret` header — return 403 if missing
- [ ] Never log extracted text (may contain sensitive financial data)
- [ ] Set 30s timeout on the Anthropic SDK call
- [ ] Store `rawResponse` in `ai_raw_response` column for cost auditing

## Mocking for Tests

```typescript
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ text: JSON.stringify({
          docType: 'bas_statements',
          financialYears: ['FY2023', 'FY2024'],
          confidence: 0.92,
          formatWarning: null,
          reasoning: 'GST activity statement format detected'
        })}]
      })
    }
  }))
}))
```
