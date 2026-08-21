FROM eclipse-temurin:21-jre@sha256:26d6c10ecf99071e134966d7be598e4bbbdb7462637e382b8e3bc3226794dcf6

ARG JENA_VERSION=6.1.0
ARG JENA_SHA512=75457f45d14397876a41ed51abe7ae5d2f1e708dfe1315765f858158bc5c6813bc036ec1539ddc4dffd26201f5cc31fadec299ca5c3dc2548b723513ed31d326
RUN apt-get update \
 && apt-get install --yes --no-install-recommends curl ca-certificates \
 && curl --fail --location --retry 3 --output /tmp/fuseki.tar.gz "https://archive.apache.org/dist/jena/binaries/apache-jena-fuseki-${JENA_VERSION}.tar.gz" \
 && echo "${JENA_SHA512}  /tmp/fuseki.tar.gz" | sha512sum --check --strict \
 && mkdir /opt/fuseki \
 && tar --extract --gzip --file /tmp/fuseki.tar.gz --strip-components=1 --directory /opt/fuseki \
 && rm -f /tmp/fuseki.tar.gz \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 10001 --home-dir /fuseki --create-home fuseki \
 && mkdir -p /fuseki/databases \
 && chown -R fuseki:fuseki /fuseki
RUN mkdir -p /fuseki/run && chown fuseki:fuseki /fuseki/run
ENV FUSEKI_BASE=/fuseki/run
USER 10001:10001
EXPOSE 3030
ENTRYPOINT ["/opt/fuseki/fuseki-server"]
CMD ["--tdb2", "--update", "--loc=/fuseki/databases", "/jwb"]
