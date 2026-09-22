-- Move the eight legacy assets that were misclassified as background patterns
-- into the central-symbol layer. The storage objects are reused in place.

update public.novel_thumbnail_assets
   set layer_type = 'symbol'
 where id in (
   '11b536f0-9292-4786-9f20-80b123a42f1a',
   '316e31bc-a6a6-41a9-a566-d9695227b6cf',
   'bdf127e5-7702-404a-9508-669dae14cdb3',
   'ea0e0d5c-e989-401d-91c3-c78c27a4158a',
   'e0be95a3-c3a7-4c4a-ba4f-a3bde4e9b2cb',
   'a01c5608-93f3-4f84-a77a-35fcd91041e6',
   '2bfd22b4-aa9e-4296-85ee-4e3fa5d9efb7',
   'fa657878-aed6-4ebf-85ae-3012f29b9092'
 )
   and layer_type = 'pattern'
   and template_key = 'book-v1'
   and availability_status = 'active';
