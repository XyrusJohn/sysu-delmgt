ALTER TABLE app_driver_action_events
    ADD COLUMN shipment_ref_reversed VARCHAR(128)
        GENERATED ALWAYS AS (
            REVERSE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$.subjectId')), 'null'))
        ) STORED,
    ADD KEY idx_app_driver_action_events_shipment_suffix
        (shipment_ref_reversed, event_type, driver_id, session_id);
