ALTER TABLE app_driver_action_events
    ADD COLUMN shipment_ref VARCHAR(128)
        GENERATED ALWAYS AS (
            NULLIF(JSON_UNQUOTE(JSON_EXTRACT(data, '$.subjectId')), 'null')
        ) STORED,
    ADD KEY idx_app_driver_action_events_shipment_search
        (shipment_ref, event_type, driver_id, session_id);
