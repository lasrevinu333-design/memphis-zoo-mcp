# Do not seed reminder-only locations into NFC inventory

Reminder-only schedule assignments are not NFC scan locations. Do not seed them into the NFC scan inventory and do not create fake rows in `locations` just to silence audits.

Do **not** create fake NFC location rows for:

- gift shops, including Bamboo Gift Shop, Elephant Trunk Gift Shop, and North West Passage Gift Shop;
- Elephant Trunk employee restrooms;
- Primate Canyon;
- Cat Country.

Do not insert, update, delete, rename, create, alter, or otherwise mutate production data for this task. SQL in this task is verification-only unless an operator explicitly approves a later data-change task. Reminder-aware audits should classify empty reminder-only groups as valid instead of relying on SQL writes.
