# Nishorgo API — PHP 8.4 + Laravel 12
FROM php:8.4-cli-alpine

RUN apk add --no-cache libpq icu-libs libzip \
 && apk add --no-cache --virtual .build-deps postgresql-dev libzip-dev icu-dev \
 && docker-php-ext-install pdo_pgsql zip intl bcmath opcache \
 && apk del .build-deps

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction

COPY . .
RUN composer dump-autoload --optimize \
 && mkdir -p storage/framework/cache storage/framework/views storage/framework/sessions storage/logs bootstrap/cache \
 && chown -R www-data:www-data storage bootstrap/cache

USER www-data
EXPOSE 8000
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
