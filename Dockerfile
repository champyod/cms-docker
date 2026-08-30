# syntax=docker/dockerfile:1
# Supported combinations: ubuntu:noble, debian:bookworm.
#
# Base-image policy: digests are bumped manually (dependabot-style PRs), never
# via in-build `apt-get upgrade`. To pin an immutable base, resolve the digest
# (`docker buildx imagetools inspect ubuntu:noble`) and set:
#   ARG BASE_IMAGE=ubuntu:noble@sha256:<digest>
ARG BASE_IMAGE=ubuntu:noble
FROM ${BASE_IMAGE}

# Default mirror. Override with --build-arg APT_MIRROR=mirror.example.com
ARG APT_MIRROR=archive.ubuntu.com

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
    elif [ -f /etc/apt/sources.list ]; then
        sed -i "s|archive.ubuntu.com|${APT_MIRROR}|g" /etc/apt/sources.list
    fi

    apt-get update
    # No `apt-get upgrade` on purpose: package drift is handled by bumping the
    # pinned BASE_IMAGE digest instead (see base-image policy at top of file).
    ARCH=$(dpkg --print-architecture)
    PACKAGES=(
        build-essential
        # cppreference-doc-en-html removed: ~500MB of offline C/C++ docs,
        # documentation-only, never used at runtime or during grading;
        # grading languages are unaffected.
        curl
        default-jdk-headless
        fp-compiler
        ghc
        git
        libcap-dev
        libffi-dev
        libpq-dev
        libyaml-dev
        cgroup-tools
        mono-mcs
        php-cli
        postgresql-client
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
    if [ "$ARCH" = "amd64" ]; then
        PACKAGES+=(pypy3)
    fi
    apt-get install -y "${PACKAGES[@]}"
EOF

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked <<EOF
#!/bin/bash -ex
    export DEBIAN_FRONTEND=noninteractive
    
    # Detect Architecture
    ARCH=$(dpkg --print-architecture)
    
    if [ "\$ARCH" = "amd64" ]; then
        echo "Installing Isolate from UCW Repository (AMD64)..."
        CODENAME=$(source /etc/os-release; echo \$VERSION_CODENAME)
        echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/isolate.asc]" \
            "http://www.ucw.cz/isolate/debian/ \${CODENAME}-isolate main" \
            >/etc/apt/sources.list.d/isolate.list
        curl https://www.ucw.cz/isolate/debian/signing-key.asc \
            >/etc/apt/keyrings/isolate.asc
        apt-get update
        apt-get install -y isolate
    else
        echo "Building Isolate from Source (ARM64/Other)..."
        apt-get update
        # Install build dependencies (libcap-dev is already in list, need libsystemd-dev, libseccomp-dev for isolate)
        apt-get install -y libsystemd-dev libseccomp-dev asciidoc
        
        git clone https://github.com/ioi/isolate.git /tmp/isolate
        pushd /tmp/isolate
        make -j$(nproc)
        make install
        # Manually create isolate group if not exists (source build doesn't always do it)
        getent group isolate || groupadd -r isolate
        popd
        rm -rf /tmp/isolate
    fi
    
    # Common config
    if [ -f /etc/isolate ]; then
        sed -i 's@^cg_root .*@cg_root = /sys/fs/cgroup@' /etc/isolate
    fi
EOF

# Create cmsuser user with least-privilege sudo and access to isolate
RUN <<EOF
#!/bin/bash -ex
    # Need to set user ID manually: otherwise it'd be 1000 on debian
    # and 1001 on ubuntu.
    useradd -ms /bin/bash -u 1001 cmsuser
    usermod -aG isolate cmsuser
    # Exact-command sudo whitelist (replaces broad '%sudo ALL=(ALL)
    # NOPASSWD:ALL'): only what runtime compose commands need after the
    # parallel compose consolidation — log/cache dir setup, permission fixes,
    # config writes via tee, isolate cgroup cleanup. Paths verified against
    # ubuntu:noble (usrmerge: /bin -> /usr/bin, /sbin -> /usr/sbin);
    # cgdelete ships at /usr/bin/cgdelete on noble; /usr/sbin/cgdelete
    # included for compatibility with pre-usrmerge layouts and task whitelist.
    {
        echo 'Cmnd_Alias CMS_MKDIR = /usr/bin/mkdir, /bin/mkdir'
        echo 'Cmnd_Alias CMS_CHOWN = /usr/bin/chown, /bin/chown'
        echo 'Cmnd_Alias CMS_CHMOD = /usr/bin/chmod, /bin/chmod'
        echo 'Cmnd_Alias CMS_TEE = /usr/bin/tee, /bin/tee'
        echo 'Cmnd_Alias CMS_CGDELETE = /usr/bin/cgdelete, /usr/sbin/cgdelete'
        echo 'cmsuser ALL=(root) NOPASSWD: CMS_MKDIR, CMS_CHOWN, CMS_CHMOD, CMS_TEE, CMS_CGDELETE'
    } >> /etc/sudoers
    visudo -cf /etc/sudoers
EOF

# Set cmsuser as default user
USER cmsuser
ENV LANG=C.UTF-8

RUN mkdir /home/cmsuser/src
WORKDIR /home/cmsuser/src

# Copy everything first so we can merge constraints
COPY --chown=cmsuser:cmsuser . /home/cmsuser/src

# Merge constraints: Root overrides take precedence over Submodule constraints
RUN <<EOF
#!/bin/bash -ex
    # Create a temporary merged constraints file
    # We put root constraints first so they override src/constraints
    if [ -f constraints.txt ]; then
        cat constraints.txt src/constraints.txt > constraints.merged.txt
        # De-duplicate: Keep first occurrence (the override)
        awk -F'==' '!a[$1]++' constraints.merged.txt > constraints.final.txt
        # Copy the merged result to BOTH locations so any install script finds it
        cp constraints.final.txt constraints.txt
        cp constraints.final.txt src/constraints.txt
        rm constraints.merged.txt constraints.final.txt
    fi
EOF

# Use the install script from src/
RUN --mount=type=cache,target=/home/cmsuser/.cache/pip,uid=1001 python3 src/install.py venv
ENV PATH="/home/cmsuser/cms/bin:$PATH"

# Install CMS package from the src directory
RUN --mount=type=cache,target=/home/cmsuser/.cache/pip,uid=1001 cd src && python3 install.py cms --devel

RUN <<EOF
#!/bin/bash -ex
    sed 's|/cmsuser:your_password_here@localhost:5432/cmsdb"|/postgres@testdb:5432/cmsdbfortesting"|' \
        ./config/cms.sample.toml >../cms/etc/cms-testdb.toml
    sed -e 's|/cmsuser:your_password_here@localhost:5432/cmsdb"|/postgres@devdb:5432/cmsdb"|' \
        -e 's/127.0.0.1/0.0.0.0/' \
        ./config/cms.sample.toml >../cms/etc/cms-devdb.toml
    sed -i 's/127.0.0.1/0.0.0.0/' ../cms/etc/cms_ranking.toml
EOF

CMD ["/bin/bash"]
