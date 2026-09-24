-- Receipts are retry metadata, not retained user data. They must never make an
-- otherwise valid account removal fail after a board lifecycle operation.
alter table lifecycle_receipts
 drop constraint if exists lifecycle_receipts_actor_id_fkey;
alter table lifecycle_receipts
 add constraint lifecycle_receipts_actor_id_fkey
 foreign key (actor_id) references "user"(id) on delete cascade;
