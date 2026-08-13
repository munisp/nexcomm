FROM quay.io/keycloak/keycloak:26.7.0

ENV KC_HEALTH_ENABLED=true \
    KC_METRICS_ENABLED=true \
    KC_DB=postgres

RUN /opt/keycloak/bin/kc.sh build --health-enabled=true --metrics-enabled=true --db=postgres

ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
