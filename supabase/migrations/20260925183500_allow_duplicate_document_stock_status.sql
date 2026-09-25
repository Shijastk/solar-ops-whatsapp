ALTER TABLE public.document_drafts
  DROP CONSTRAINT document_drafts_stock_status_check;

ALTER TABLE public.document_drafts
  ADD CONSTRAINT document_drafts_stock_status_check
  CHECK (
    stock_status = ANY (
      ARRAY[
        'not_ready'::text,
        'pending'::text,
        'applied'::text,
        'needs_product_match'::text,
        'company_unmapped'::text,
        'insufficient_stock'::text,
        'duplicate_document'::text,
        'invalid_item'::text,
        'inconsistent'::text,
        'reversed'::text
      ]
    )
  );
