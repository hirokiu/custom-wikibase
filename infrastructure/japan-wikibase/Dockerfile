ARG MEDIAWIKI_IMAGE=mediawiki:1.43.9@sha256:77a2dda59645bd41c9648eb131416363416208db5936957ae45db3b64d3690f8
ARG COMPOSER_IMAGE=composer/composer:2.8.11-bin@sha256:abd63db39eb2565a5af2bece27befd9bdf1041938b5caf200852f3458b8b3592

FROM ${COMPOSER_IMAGE} AS composer
FROM ${MEDIAWIKI_IMAGE}

ARG WIKIBASE_REF=c79eb4efab9ad27267a6df9034e1b99ad695d1c7

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends git unzip; \
    rm -rf /var/lib/apt/lists/*

COPY --from=composer /composer /usr/local/bin/composer
COPY composer.lock /tmp/wikibase-composer.lock

RUN set -eux; \
    git clone https://gerrit.wikimedia.org/r/mediawiki/extensions/Wikibase /var/www/html/extensions/Wikibase; \
    cd /var/www/html/extensions/Wikibase; \
    git checkout "${WIKIBASE_REF}"; \
    test "$(git rev-parse HEAD)" = "${WIKIBASE_REF}"; \
    rm -rf .git; \
    install -m 0644 /tmp/wikibase-composer.lock composer.lock; \
    COMPOSER_ALLOW_SUPERUSER=1 composer install --no-dev --no-interaction --no-progress --prefer-dist --optimize-autoloader; \
    rm /tmp/wikibase-composer.lock; \
    composer clear-cache; \
    a2enmod rewrite headers proxy proxy_http

COPY LocalSettings.php /opt/jwb/LocalSettings.php
COPY apache.conf /etc/apache2/conf-enabled/jwb.conf
COPY entrypoint.sh /usr/local/bin/jwb-entrypoint
COPY job-runner.sh /usr/local/bin/jwb-job-runner

RUN chmod 0755 /usr/local/bin/jwb-entrypoint /usr/local/bin/jwb-job-runner; \
    chown -R www-data:www-data /var/www/html/extensions/Wikibase

LABEL org.opencontainers.image.title="Japan Wikibase Core" \
      org.opencontainers.image.description="Standalone ARM64/AMD64 MediaWiki and Wikibase distribution" \
      org.opencontainers.image.licenses="GPL-2.0-or-later" \
      org.opencontainers.image.version="0.1.0-rc.1"

ENTRYPOINT ["jwb-entrypoint"]
CMD ["apache2-foreground"]
