FROM php:8.5-apache
RUN apt-get update && apt-get install -y libicu-dev libsqlite3-dev libcurl4-openssl-dev libonig-dev ca-certificates && docker-php-ext-install pdo_sqlite intl mbstring curl && a2enmod rewrite && rm -rf /var/lib/apt/lists/*
ENV APACHE_DOCUMENT_ROOT=/var/www/html/public
RUN sed -ri 's!/var/www/html!/var/www/html/public!g' /etc/apache2/sites-available/*.conf && echo '<Directory /var/www/html/public>
AllowOverride All
Require all granted
</Directory>' >> /etc/apache2/apache2.conf
WORKDIR /var/www/html
COPY public public
COPY php php
COPY assets assets
COPY scripts/*.php scripts/
COPY team.html sw.js manifest.webmanifest ./
RUN mkdir -p data/uploads && chown -R www-data:www-data data
ENV TEAM_DATABASE=/var/www/html/data/team.sqlite TEAM_LOCAL_FILES=/var/www/html/data/uploads APP_ENV=production TEAM_STORAGE=ftp
HEALTHCHECK --interval=30s --timeout=5s CMD php -r "exit(@file_get_contents('http://127.0.0.1/healthz')===false?1:0);"
CMD ["apache2-foreground"]
