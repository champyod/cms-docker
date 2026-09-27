//! Starting the manager and every process, and waiting for all of them.
//!
//! The order is the reference's and the only one that works: the manager is started,
//! then every process is started, and only then is any of them waited for. A manager
//! and a process that have to talk to each other cannot be read back one after the
//! other, since the first waited for is still running and the second has not been
//! started. Both pipes of every run are emptied from the launch, so a run that
//! prints more than a pipe holds is read for the whole of its life.
//!
//! A process is told where its pipes are as arguments where the parameters say so,
//! and is given its own index among the processes where there is more than one,
//! which is what lets a language tell them apart. Where the pipes are the process's
//! own standard input and output instead, they are redirected rather than named.

#![deny(missing_docs)]
#![forbid(unsafe_code)]

use std::path::PathBuf;

use crate::job::EvaluationJob;
use crate::sandbox::{Launch, Options};
use crate::stats::ExecutionStats;

use super::charge::{manager_clock, memory_of, processes_of, time_of};
use super::pipes::Pipe;
use crate::tasktypes::{wall_clock_of, Run, Runtime, Toolchain};

use super::{Communication, TaskError, INPUT, MANAGER, STUB};

impl Communication {
    /// Starts the manager and hands the run back, still running.
    ///
    /// The manager is given every pair of pipes, the two names of one process after
    /// another in index order, and the input on its standard input: it reads the
    /// testcase from there rather than from a file of its own, as the reference does
    /// for a manager written before the input was a file.
    pub(super) fn start_manager(
        &self,
        run: &mut Run,
        job: &EvaluationJob,
        runtime: &Runtime,
        pipes: &[Pipe],
    ) -> Result<Launch, TaskError> {
        let time = manager_clock(self.num_processes, time_of(job)?);
        let mut command = vec![format!("./{MANAGER}")];
        for pipe in pipes {
            command.push(pipe.to_manager.clone());
            command.push(pipe.to_user.clone());
        }
        let words: Vec<&str> = command.iter().map(String::as_str).collect();
        let mut options = run.sandbox().options().clone();
        options.cpu_time = time;
        options.wall_clock_timeout = time.map(wall_clock_of);
        options.file_size = runtime.file_size;
        options.max_processes = Some(processes_of(job));
        options.directories.extend(pipes.iter().map(Pipe::mapped));
        options.stdin_file = Some(PathBuf::from(INPUT));
        run.started(&words, &options)
    }

    /// Starts every process and hands the runs back, still running.
    ///
    /// Every process is started before any of them is waited for, which is the only
    /// order in which a manager and a process can talk at all: a process started
    /// after the manager had ended would find nobody at the other end of its pipe.
    pub(super) fn start_users(
        &self,
        runs: &mut [Run],
        job: &EvaluationJob,
        toolchain: &dyn Toolchain,
        runtime: &Runtime,
        pipes: &[Pipe],
        executable: &str,
    ) -> Result<Vec<Launch>, TaskError> {
        let time = time_of(job)?;
        let memory = memory_of(job)?;
        let mut launches = Vec::with_capacity(runs.len());
        for (index, run) in runs.iter_mut().enumerate() {
            let commands = self.commands_of(toolchain, executable, &pipes[index], index);
            let options = self.options_for(run, job, runtime, &pipes[index], time, memory);
            let words = words_of(&commands);
            launches.push(run.started(&words, &options)?);
        }
        Ok(launches)
    }

    /// The options one process is launched under: the dataset's own two limits, the
    /// box's bound on how large a file may be, the one pair of pipes this process
    /// was given, and the two streams the parameters ask for.
    fn options_for(
        &self,
        run: &mut Run,
        job: &EvaluationJob,
        runtime: &Runtime,
        pipe: &Pipe,
        time: Option<std::time::Duration>,
        memory: Option<u64>,
    ) -> Options {
        let mut options = run.sandbox().options().clone();
        options.cpu_time = time;
        options.wall_clock_timeout = time.map(wall_clock_of);
        options.address_space = memory;
        options.file_size = runtime.file_size;
        options.max_processes = Some(processes_of(job));
        options.directories.push(pipe.mapped());
        if !self.uses_fifos() {
            options.stdin_file = Some(PathBuf::from(&pipe.to_user));
            options.stdout_file = Some(PathBuf::from(&pipe.to_manager));
        }
        options
    }

    /// The commands that run one process, which the language answers for.
    ///
    /// The last command is the process itself, and the words before it are the
    /// language's own setup, which the reference gives a trusted step and this worker
    /// has none of: only the last is launched, as the reference also only launches
    /// the last under the dataset's limits.
    fn commands_of(
        &self,
        toolchain: &dyn Toolchain,
        executable: &str,
        pipe: &Pipe,
        index: usize,
    ) -> Vec<Vec<String>> {
        let mut args = Vec::new();
        if self.uses_fifos() {
            args.push(pipe.to_user.clone());
            args.push(pipe.to_manager.clone());
        }
        if self.num_processes != 1 {
            args.push(index.to_string());
        }
        let main = if self.uses_stub() {
            STUB.to_owned()
        } else {
            executable.to_owned()
        };
        toolchain.evaluation_commands(executable, &main, &args)
    }
}

/// Waits for every run, the manager's first and the processes after it in index
/// order, and answers with what each left behind.
///
/// The order is only which answer is read first: every run was started before this
/// was called and every pipe was emptied from its launch, so a run still writing
/// while another ended was being read the whole time.
pub(super) fn drain_all(
    first: Launch,
    rest: Vec<Launch>,
) -> Result<(ExecutionStats, Vec<ExecutionStats>), TaskError> {
    let manager = first.wait().map_err(TaskError::Spawn)?;
    let mut users = Vec::with_capacity(rest.len());
    for launch in rest {
        users.push(launch.wait().map_err(TaskError::Spawn)?);
    }
    Ok((manager, users))
}

/// The last of a language's commands, which is the process itself, as the words a
/// run is launched with, and no words at all where a language named none, which the
/// wrapper refuses rather than launching.
fn words_of(commands: &[Vec<String>]) -> Vec<&str> {
    let Some(last) = commands.last() else {
        return Vec::new();
    };
    last.iter().map(String::as_str).collect()
}
