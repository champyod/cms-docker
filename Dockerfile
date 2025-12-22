# syntax=docker/dockerfile:1
# Supported combinations: ubuntu:noble, debian:bookworm.
ARG BASE_IMAGE=ubuntu:noble
FROM ${BASE_IMAGE}

# Default mirror for faster builds in Thailand. Override with --build-arg APT_MIRROR=archive.ubuntu.com
ARG APT_MIRROR=th.archive.ubuntu.com
# ARM (Raspberry Pi) mirror. Global CDN is actually faster than Thai mirror.
ARG APT_PORTS_MIRROR=ports.ubuntu.com

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked <<EOF
#!/bin/bash -ex
    export DEBIAN_FRONTEND=noninteractive
    # Don't delete all the .deb files after install, as that would make the
    # cache useless.
    rm -f /etc/apt/apt.conf.d/docker-clean
    # Note that we use apt-get here instead of plain apt, because plain apt
    # also deletes .deb files after successful install.

    # Use configured mirror for faster builds
    if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then
        sed -i "s|archive.ubuntu.com|${APT_MIRROR}|g" /etc/apt/sources.list.d/ubuntu.sources
        sed -i "s|security.ubuntu.com|${APT_MIRROR}|g" /etc/apt/sources.list.d/ubuntu.sources
        sed -i "s|ports.ubuntu.com|${APT_PORTS_MIRROR}|g" /etc/apt/sources.list.d/ubuntu.sources
    elif [ -f /etc/apt/sources.list ]; then
        sed -i "s|archive.ubuntu.com|${APT_MIRROR}|g" /etc/apt/sources.list
        sed -i "s|security.ubuntu.com|${APT_MIRROR}|g" /etc/apt/sources.list
        sed -i "s|ports.ubuntu.com|${APT_PORTS_MIRROR}|g" /etc/apt/sources.list
    fi

    apt-get update
    apt-get upgrade -y
    PACKAGES=(
        build-essential
        cppreference-doc-en-html
        curl
        default-jdk-headless
        fp-compiler
        ghc
        git
        libcap-dev
        libffi-dev
        libpq-dev
        libyaml-dev
        mono-mcs
        php-cli
        postgresql-client
        pypy3
        python3
        python3-dev
        python3-pip
        python3-venv
        rustc
        shared-mime-info
        sudo
        wait-for-it
        zip
    )
    apt-get install -y "${PACKAGES[@]}"
EOF

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked <<EOF
#!/bin/bash -ex
    export DEBIAN_FRONTEND=noninteractive
    ARCH=$(dpkg --print-architecture)
    CODENAME=$(source /etc/os-release; echo $VERSION_CODENAME)
    
    # Add isolate repository
    mkdir -p /etc/apt/keyrings
    echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/isolate.asc]" \
        "http://www.ucw.cz/isolate/debian/ ${CODENAME}-isolate main" \
        >/etc/apt/sources.list.d/isolate.list
    curl -fsSL https://www.ucw.cz/isolate/debian/signing-key.asc \
        >/etc/apt/keyrings/isolate.asc || echo "Warning: Failed to download isolate key"
    
    # Update and try to install package (works on amd64, experimental on arm64)
    apt-get update || true
    if apt-get install -y isolate; then
        echo "Installed isolate from package"
    else
        # Fall back to building from source (arm64 packages may not exist for this distro)
        echo "Package not available, building from source..."
        apt-get install -y libcap-dev libsystemd-dev asciidoc-base
        git clone https://github.com/ioi/isolate.git /tmp/isolate
        cd /tmp/isolate
        make install
        rm -rf /tmp/isolate
        
        # Create isolate users (required for sandbox, usually created by package)
        groupadd -f isolate
        for i in $(seq 0 99); do
            useradd --system --no-create-home --home-dir /nonexistent \
                    --shell /usr/sbin/nologin "isolate-$i" || true
            usermod -aG isolate "isolate-$i" || true
        done
    fi
    
    # Configure isolate cgroup root (config path differs between apt and source install)
    if [ -f /etc/isolate ]; then
        sed -i 's@^cg_root .*@cg_root = /sys/fs/cgroup@' /etc/isolate
    elif [ -f /usr/local/etc/isolate ]; then
        sed -i 's@^cg_root .*@cg_root = /sys/fs/cgroup@' /usr/local/etc/isolate
    fi
EOF

# Create cmsuser user with sudo privileges and access to isolate
RUN <<EOF
#!/bin/bash -ex
    # Need to set user ID manually: otherwise it'd be 1000 on debian
    # and 1001 on ubuntu.
    useradd -ms /bin/bash -u 1001 cmsuser
    # Create isolate group if not exists (apt package creates it, source build doesn't)
    groupadd -f isolate
    usermod -aG sudo cmsuser
    usermod -aG isolate cmsuser
    # Disable sudo password
    echo '%sudo ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers
EOF

# Set cmsuser as default user
USER cmsuser
ENV LANG=C.UTF-8

RUN mkdir /home/cmsuser/src
COPY --chown=cmsuser:cmsuser src/install.py src/constraints.txt /home/cmsuser/src/

WORKDIR /home/cmsuser/src

RUN --mount=type=cache,target=/home/cmsuser/.cache/pip,uid=1001 ./install.py venv
ENV PATH="/home/cmsuser/cms/bin:$PATH"

COPY --chown=cmsuser:cmsuser . /home/cmsuser/src

RUN --mount=type=cache,target=/home/cmsuser/.cache/pip,uid=1001 ./install.py cms --devel

RUN <<EOF
#!/bin/bash -ex
    sed 's|/cmsuser:your_password_here@localhost:5432/cmsdb"|/postgres@testdb:5432/cmsdbfortesting"|' \
        ./src/config/cms.sample.toml >../cms/etc/cms-testdb.toml
    sed -e 's|/cmsuser:your_password_here@localhost:5432/cmsdb"|/postgres@devdb:5432/cmsdb"|' \
        -e 's/127.0.0.1/0.0.0.0/' \
        ./src/config/cms.sample.toml >../cms/etc/cms-devdb.toml
    sed -i 's/127.0.0.1/0.0.0.0/' ../cms/etc/cms_ranking.toml
EOF

CMD ["/bin/bash"]
