#!/usr/bin/env python3
"""Shared cms.toml fixture for the classic-admin security suites."""

import os
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = REPO_ROOT / "src"


def _config_text(with_security_url: bool) -> str:
    """Return the tracked sample made loadable, optionally with a security URL."""
    text = (REPO_ROOT / "config" / "cms.sample.toml").read_text()
    text = text.replace(
        'secret_key = "8e045a51e4b102ea803c06f92841a1fb"',
        'secret_key = "test-only-not-the-shipped-default"',
    )
    text = text.replace(
        'url = "postgresql+psycopg2://cmsuser:your_password_here@database:5432/cmsdb"',
        'url = "postgresql+psycopg2://cmsuser:pw@127.0.0.1:5432/cmsdb"',
    )
    if with_security_url:
        text = text.replace("# admin_security_url =", "admin_security_url =")
        text = text.replace("cms_admin_account_security:PASSWORD@",
                            "cms_admin_account_security:test-sec-pw@")
    return text


def install_config(with_security_url: bool) -> Path:
    """Write a loadable cms.toml and point CMS_CONFIG at it."""
    workdir = Path(tempfile.mkdtemp(prefix="cms-admin-security-"))
    path = workdir / "cms.toml"
    path.write_text(_config_text(with_security_url))
    os.environ["CMS_CONFIG"] = str(path)
    return path
