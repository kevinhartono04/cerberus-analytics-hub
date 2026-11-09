# Event Generation settings

Internal administrators can edit the master tracking-spec template at **Admin → Event Generation**. Drafts, previews, and published versions are separate: save a draft, test it with a sample game, review the differences, then publish. Existing saved specs keep their contents. Future generations use the published version, recorded as `generationTemplateVersion`.

The editor supports event definitions, shared payload definitions, per-event overrides, platform ad fields, and intake-dependent rules. The original library seeds the initial template; default generation remains unchanged until a template is published. Published definitions are authoritative, so AI enhancement does not rewrite them.

API authorization uses the existing internal-admin policy. Revision checks reject stale saves and publication requires a saved draft. A single durable `event_generation_settings` row stores the draft and published configuration in private application storage. The table is initialized by the application, with row-level security enabled in Cerebral's private Postgres schema; local development uses SQLite. Test publications must stay in local fixtures.

The earlier `park/generator-admin-config` prototype is intentionally not integrated. It replaces the intake UI and installs a separate generator configuration engine, overlapping with this versioned workflow. Its source remains preserved for a deliberate future reconciliation.
