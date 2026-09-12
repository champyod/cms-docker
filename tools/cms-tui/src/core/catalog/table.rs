use super::{
    CommandSpec, ARGS_ARCHIVE, ARGS_NONE, ARGS_SECRET_FLAG, MAKE_ADMIN_CREATE, MAKE_BACKUP,
    MAKE_CMS_INIT, MAKE_DB_CLEAN, MAKE_DB_RESET, MAKE_PRISMA_SYNC, SCRIPT_BACKUP_DRILL,
    SCRIPT_MONITOR, SCRIPT_OFFSITE_SYNC, SCRIPT_PREFLIGHT, SCRIPT_RESTORE, SCRIPT_SECRETS_ROTATE,
    SCRIPT_SMOKE_TEST, SCRIPT_STATUS, SCRIPT_UPDATE_ENGINE, SCRIPT_UPDATE_SERVER,
};
use crate::core::dispatch::{DispatchKey, DispatchTarget};

pub const CORE_CATALOG: &[CommandSpec] = &[
    CommandSpec {
        key: DispatchKey::Setup,
        target: DispatchTarget::Script(SCRIPT_UPDATE_ENGINE),
        args: ARGS_NONE,
        about: "First-time guided setup",
    },
    CommandSpec {
        key: DispatchKey::Update,
        target: DispatchTarget::Script(SCRIPT_UPDATE_ENGINE),
        args: ARGS_NONE,
        about: "Interactive config update wizard",
    },
    CommandSpec {
        key: DispatchKey::UpdateAll,
        target: DispatchTarget::Script(SCRIPT_UPDATE_SERVER),
        args: ARGS_NONE,
        about: "Full server update",
    },
    CommandSpec {
        key: DispatchKey::Fix,
        target: DispatchTarget::Script(SCRIPT_UPDATE_ENGINE),
        args: ARGS_NONE,
        about: "Non-interactive repair",
    },
    CommandSpec {
        key: DispatchKey::DbInit,
        target: DispatchTarget::Make(MAKE_CMS_INIT),
        args: ARGS_NONE,
        about: "Database init",
    },
    CommandSpec {
        key: DispatchKey::DbReset,
        target: DispatchTarget::Make(MAKE_DB_RESET),
        args: ARGS_NONE,
        about: "Database reset",
    },
    CommandSpec {
        key: DispatchKey::DbClean,
        target: DispatchTarget::Make(MAKE_DB_CLEAN),
        args: ARGS_NONE,
        about: "Database clean",
    },
    CommandSpec {
        key: DispatchKey::DbSync,
        target: DispatchTarget::Make(MAKE_PRISMA_SYNC),
        args: ARGS_NONE,
        about: "Prisma sync",
    },
    CommandSpec {
        key: DispatchKey::AdminCreate,
        target: DispatchTarget::Make(MAKE_ADMIN_CREATE),
        args: ARGS_NONE,
        about: "Create superadmin",
    },
    CommandSpec {
        key: DispatchKey::Status,
        target: DispatchTarget::Script(SCRIPT_STATUS),
        args: ARGS_NONE,
        about: "Live service status",
    },
    CommandSpec {
        key: DispatchKey::Monitor,
        target: DispatchTarget::Script(SCRIPT_MONITOR),
        args: ARGS_NONE,
        about: "Monitoring UI",
    },
    CommandSpec {
        key: DispatchKey::Backup,
        target: DispatchTarget::Make(MAKE_BACKUP),
        args: ARGS_NONE,
        about: "Run backup now",
    },
    CommandSpec {
        key: DispatchKey::BackupDrill,
        target: DispatchTarget::Script(SCRIPT_BACKUP_DRILL),
        args: ARGS_NONE,
        about: "Backup drill",
    },
    CommandSpec {
        key: DispatchKey::BackupOffsite,
        target: DispatchTarget::Script(SCRIPT_OFFSITE_SYNC),
        args: ARGS_NONE,
        about: "Offsite sync",
    },
    CommandSpec {
        key: DispatchKey::Restore,
        target: DispatchTarget::Script(SCRIPT_RESTORE),
        args: ARGS_ARCHIVE,
        about: "Restore archive",
    },
    CommandSpec {
        key: DispatchKey::SecretsRotate,
        target: DispatchTarget::Script(SCRIPT_SECRETS_ROTATE),
        args: ARGS_SECRET_FLAG,
        about: "Rotate secrets",
    },
    CommandSpec {
        key: DispatchKey::SecretsAudit,
        target: DispatchTarget::Script(SCRIPT_SECRETS_ROTATE),
        args: ARGS_SECRET_FLAG,
        about: "Audit secrets",
    },
    CommandSpec {
        key: DispatchKey::SecretsGenerate,
        target: DispatchTarget::Script(SCRIPT_SECRETS_ROTATE),
        args: ARGS_SECRET_FLAG,
        about: "Generate secrets",
    },
    CommandSpec {
        key: DispatchKey::Doctor,
        target: DispatchTarget::Script(SCRIPT_PREFLIGHT),
        args: ARGS_NONE,
        about: "Preflight checks",
    },
    CommandSpec {
        key: DispatchKey::Test,
        target: DispatchTarget::Script(SCRIPT_SMOKE_TEST),
        args: ARGS_NONE,
        about: "Smoke-test",
    },
];
