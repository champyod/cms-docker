use super::{
    BackupSub, Commands, ConfigSub, ContestSub, DbSub, DomainSub, FunnelSub, SecretsSub,
    TailscaleSub, WorkerSub,
};

/// Exhaustive dispatcher — each variant calls a named async stub that prints the
/// resolved action and returns `Ok(())`. No real execution (Phase 3 wires core).
pub async fn handle(cmd: Commands) -> Result<(), Box<dyn std::error::Error>> {
    match cmd {
        Commands::Setup => cmd_setup().await,
        Commands::Update { all } => cmd_update(all).await,
        Commands::Fix => cmd_fix().await,
        Commands::Deploy { target, img } => cmd_deploy(target, img).await,
        Commands::Stop { stack } => cmd_stop(stack).await,
        Commands::Clean { stack } => cmd_clean(stack).await,
        Commands::Pull { stack } => cmd_pull(stack).await,
        Commands::Db { sub } => cmd_db(sub).await,
        Commands::AdminCreate => cmd_admin_create().await,
        Commands::Status => cmd_status().await,
        Commands::Monitor => cmd_monitor().await,
        Commands::Backup { sub } => cmd_backup(sub).await,
        Commands::Restore { archive } => cmd_restore(archive).await,
        Commands::Secrets { sub } => cmd_secrets(sub).await,
        Commands::Doctor => cmd_doctor().await,
        Commands::Test => cmd_test().await,
        Commands::Worker { sub } => cmd_worker(sub).await,
        Commands::Tailscale { sub } => cmd_tailscale(sub).await,
        Commands::Expose => cmd_expose().await,
        Commands::Funnel { sub } => cmd_funnel(sub).await,
        Commands::Contest { sub } => cmd_contest(sub).await,
        Commands::UpdateServer => cmd_update_server().await,
        Commands::Domain { sub } => cmd_domain(sub).await,
        Commands::Config { sub } => cmd_config(sub).await,
    }
}

async fn cmd_setup() -> Result<(), Box<dyn std::error::Error>> {
    println!("setup");
    Ok(())
}

async fn cmd_update(all: bool) -> Result<(), Box<dyn std::error::Error>> {
    if all {
        println!("update all");
    } else {
        println!("update");
    }
    Ok(())
}

async fn cmd_fix() -> Result<(), Box<dyn std::error::Error>> {
    println!("fix");
    Ok(())
}

async fn cmd_deploy(target: String, img: bool) -> Result<(), Box<dyn std::error::Error>> {
    if img {
        println!("deploy {target} --img");
    } else {
        println!("deploy {target}");
    }
    Ok(())
}

async fn cmd_stop(stack: String) -> Result<(), Box<dyn std::error::Error>> {
    println!("stop {stack}");
    Ok(())
}

async fn cmd_clean(stack: String) -> Result<(), Box<dyn std::error::Error>> {
    println!("clean {stack}");
    Ok(())
}

async fn cmd_pull(stack: String) -> Result<(), Box<dyn std::error::Error>> {
    println!("pull {stack}");
    Ok(())
}

async fn cmd_db(sub: DbSub) -> Result<(), Box<dyn std::error::Error>> {
    match sub {
        DbSub::Init => println!("db init"),
        DbSub::Reset => println!("db reset"),
        DbSub::Clean => println!("db clean"),
        DbSub::Sync => println!("db sync"),
    }
    Ok(())
}

async fn cmd_admin_create() -> Result<(), Box<dyn std::error::Error>> {
    println!("admin-create");
    Ok(())
}

async fn cmd_status() -> Result<(), Box<dyn std::error::Error>> {
    println!("status");
    Ok(())
}

async fn cmd_monitor() -> Result<(), Box<dyn std::error::Error>> {
    println!("monitor");
    Ok(())
}

async fn cmd_backup(sub: Option<BackupSub>) -> Result<(), Box<dyn std::error::Error>> {
    match sub {
        Some(BackupSub::Drill) => println!("backup drill"),
        Some(BackupSub::Offsite) => println!("backup offsite"),
        None => println!("backup"),
    }
    Ok(())
}

async fn cmd_restore(archive: String) -> Result<(), Box<dyn std::error::Error>> {
    println!("restore {archive}");
    Ok(())
}

async fn cmd_secrets(sub: SecretsSub) -> Result<(), Box<dyn std::error::Error>> {
    match sub {
        SecretsSub::Rotate => println!("secrets rotate"),
        SecretsSub::Audit => println!("secrets audit"),
        SecretsSub::Generate => println!("secrets generate"),
    }
    Ok(())
}

async fn cmd_doctor() -> Result<(), Box<dyn std::error::Error>> {
    println!("doctor");
    Ok(())
}

async fn cmd_test() -> Result<(), Box<dyn std::error::Error>> {
    println!("test");
    Ok(())
}

async fn cmd_worker(sub: WorkerSub) -> Result<(), Box<dyn std::error::Error>> {
    match sub {
        WorkerSub::Edit => println!("worker edit"),
        WorkerSub::Deploy => println!("worker deploy"),
        WorkerSub::Stop => println!("worker stop"),
        WorkerSub::List => println!("worker list"),
        WorkerSub::Server => println!("worker server"),
        WorkerSub::Connect => println!("worker connect"),
        WorkerSub::Cgroup => println!("worker cgroup"),
    }
    Ok(())
}

async fn cmd_tailscale(sub: TailscaleSub) -> Result<(), Box<dyn std::error::Error>> {
    match sub {
        TailscaleSub::Setup => println!("tailscale setup"),
        TailscaleSub::Status => println!("tailscale status"),
        TailscaleSub::Remove => println!("tailscale remove"),
    }
    Ok(())
}

async fn cmd_expose() -> Result<(), Box<dyn std::error::Error>> {
    println!("expose");
    Ok(())
}

async fn cmd_funnel(sub: FunnelSub) -> Result<(), Box<dyn std::error::Error>> {
    match sub {
        FunnelSub::Setup => println!("funnel setup"),
        FunnelSub::Passwd => println!("funnel passwd"),
        FunnelSub::Remove => println!("funnel remove"),
        FunnelSub::Status => println!("funnel status"),
    }
    Ok(())
}

async fn cmd_contest(sub: ContestSub) -> Result<(), Box<dyn std::error::Error>> {
    match sub {
        ContestSub::Create => println!("contest create"),
    }
    Ok(())
}

async fn cmd_update_server() -> Result<(), Box<dyn std::error::Error>> {
    println!("update-server");
    Ok(())
}

async fn cmd_domain(sub: DomainSub) -> Result<(), Box<dyn std::error::Error>> {
    match sub {
        DomainSub::Setup => println!("domain setup"),
        DomainSub::Status => println!("domain status"),
        DomainSub::Renew => println!("domain renew"),
        DomainSub::Preflight => println!("domain preflight"),
    }
    Ok(())
}

async fn cmd_config(sub: ConfigSub) -> Result<(), Box<dyn std::error::Error>> {
    match sub {
        ConfigSub::Sync => println!("config sync"),
        ConfigSub::Edit => println!("config edit"),
        ConfigSub::Show => println!("config show"),
    }
    Ok(())
}
