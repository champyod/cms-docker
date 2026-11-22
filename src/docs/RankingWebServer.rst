RankingWebServer
****************

Replaced
========

The Python RankingWebServer is gone. The Rust ``cms-ranking`` service in :gh_tree:`ranking-web` is
what the image installs and what the ranking container runs: it reads the projection tables in
PostgreSQL instead of a private JSON store, takes the contests it draws from the ``services``
registry row, and serves the same public routes (``/``, ``/scores``, ``/history``, ``/events``,
``/logo``, ``/config``, ``/credits``).

Its configuration is the environment only (``RANKING_BIND_ADDRESS``, ``DATABASE_URL``,
``RANKING_SHARD``, ``RANKING_STATIC_DIR``, ``CMS_CREDITS_FILE``, ``RANKING_LOGO_PATH``,
``RANKING_AVATAR_DIR``), so there is no :file:`cms_ranking.toml` to write and no ``--drop`` to run.
The fork's own guide to running it is :file:`docs/SERVICE_GUIDE.md`.

This page described the Python service's configuration file, its private data directory and its
nginx setup. That was removed with the package rather than kept as instructions nobody can follow.
