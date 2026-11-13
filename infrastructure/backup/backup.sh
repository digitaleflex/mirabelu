#!/bin/sh
# Sauvegarde PostgreSQL périodique avec rotation. Lancé en boucle par le service « backup » de docker-compose.
# Variables : PGHOST, PGUSER, PGPASSWORD, PGDATABASE (standard libpq), BACKUP_DIR,
# BACKUP_RETENTION_DAYS (14 par défaut), BACKUP_INTERVAL_SECONDS (86400 par défaut).
set -eu

DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_RETENTION_DAYS:-14}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
mkdir -p "$DIR"

while true; do
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  PARTIAL="$DIR/mirabelu-$STAMP.dump.partial"
  if pg_dump --format=custom --no-owner --file="$PARTIAL"; then
    # Le fichier n'apparaît sous son vrai nom qu'une fois complet.
    mv "$PARTIAL" "$DIR/mirabelu-$STAMP.dump"
    echo "sauvegarde ok : mirabelu-$STAMP.dump"
    # Rotation : uniquement après une sauvegarde réussie, et seulement les fichiers de ce service.
    find "$DIR" -maxdepth 1 -name 'mirabelu-*.dump' -mtime +"$KEEP_DAYS" -delete
  else
    echo "ÉCHEC de la sauvegarde" >&2
  fi
  sleep "$INTERVAL"
done
