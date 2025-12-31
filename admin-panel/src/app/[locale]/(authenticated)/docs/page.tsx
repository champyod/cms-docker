import { AlertCircle, Book, CheckCircle, Code, HelpCircle, Terminal, Users, Flag, Trophy, Server, Activity, Cpu } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/core/Card';

export default function DocsPage() {
  return (
    <div className="flex min-h-screen overflow-hidden bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-neutral-900 via-black to-neutral-950">
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {/* Background effects */}
        <div className="absolute top-0 left-0 w-full h-[500px] bg-indigo-600/10 blur-[120px] rounded-full pointer-events-none -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-cyan-600/5 blur-[100px] rounded-full pointer-events-none translate-y-1/2" />

        <div className="flex-1 overflow-y-auto p-8 z-10 scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20">
          <div className="max-w-5xl mx-auto space-y-12">
            <div className="flex items-center justify-between border-b border-white/10 pb-6">
              <div>
                <h1 className="text-3xl font-bold text-white mb-2">CMS Documentation</h1>
                <p className="text-neutral-400">Comprehensive guide to the Contest Management System.</p>
              </div>
              <a
                href="https://cms-dev.github.io/cms/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors border border-white/5"
              >
                <Book className="w-4 h-4" />
                CMS Official Docs
              </a>
            </div>

            {/* Navigation Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Link href="#contests" className="p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/5 transition-colors group">
                <Trophy className="w-6 h-6 text-amber-400 mb-2 group-hover:scale-110 transition-transform" />
                <span className="font-medium text-white block">Contests</span>
                <span className="text-xs text-neutral-500">Configuration & Timing</span>
              </Link>
              <Link href="#users" className="p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/5 transition-colors group">
                <Users className="w-6 h-6 text-cyan-400 mb-2 group-hover:scale-110 transition-transform" />
                <span className="font-medium text-white block">Users & Teams</span>
                <span className="text-xs text-neutral-500">Authentication & Groups</span>
              </Link>
              <Link href="#tasks" className="p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/5 transition-colors group">
                <Code className="w-6 h-6 text-indigo-400 mb-2 group-hover:scale-110 transition-transform" />
                <span className="font-medium text-white block">Tasks</span>
                <span className="text-xs text-neutral-500">Problems, Datasets, Tests</span>
              </Link>
              <Link href="#submissions" className="p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/5 transition-colors group">
                <Activity className="w-6 h-6 text-emerald-400 mb-2 group-hover:scale-110 transition-transform" />
                <span className="font-medium text-white block">Submissions</span>
                <span className="text-xs text-neutral-500">Monitoring & Rejudging</span>
              </Link>
              <Link href="#services" className="p-4 bg-white/5 hover:bg-white/10 rounded-xl border border-white/5 transition-colors group">
                <Server className="w-6 h-6 text-purple-400 mb-2 group-hover:scale-110 transition-transform" />
                <span className="font-medium text-white block">Services</span>
                <span className="text-xs text-neutral-500">Status & Logs</span>
              </Link>
            </div>

            {/* Contests */}
            <section id="contests" className="scroll-mt-24 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                  <Trophy className="w-6 h-6 text-amber-400" />
                  Contests
                </h2>
                <a href="https://cms-dev.github.io/cms/Contest%20Definition.html" target="_blank" className="text-xs text-indigo-400 hover:text-indigo-300">Official Docs →</a>
              </div>
              <Card className="glass-card p-6 border-white/10">
                <p className="text-neutral-300 mb-4">
                  A contest is the main container for tasks and users. You can define start/stop times, allowed languages, and participation rules.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="font-medium text-white mb-2 underline decoration-indigo-500/30">Contest Timing</h3>
                    <ul className="text-sm text-neutral-400 space-y-3">
                      <li>
                        <strong className="text-neutral-300">Start / Stop Time:</strong>
                        <p className="text-xs mt-1">The UTC interval when the contest is active. Submissions outside this window are rejected.</p>
                      </li>
                      <li>
                        <strong className="text-neutral-300">Analysis Mode:</strong>
                        <p className="text-xs mt-1">An optional period (usually after Stop Time) where contestants can view their detailed results and submit unofficial solutions if enabled.</p>
                      </li>
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-medium text-white mb-2 underline decoration-indigo-500/30">Submission Limits</h3>
                    <ul className="text-sm text-neutral-400 space-y-3">
                      <li>
                        <strong className="text-neutral-300">Token Mode:</strong>
                        <p className="text-xs mt-1">
                          <span className="text-indigo-400">• Disabled:</span> No tokens used.<br />
                          <span className="text-indigo-400">• Infinite:</span> Unlimited tokens available.<br />
                          <span className="text-indigo-400">• Limited:</span> Uses a bucket system where tokens regenerate over time.
                        </p>
                      </li>
                      <li>
                        <strong className="text-neutral-300">Minimum Interval:</strong>
                        <p className="text-xs mt-1">Forces a wait time (in seconds) between two consecutive submissions from the same user.</p>
                      </li>
                    </ul>
                  </div>
                </div>
              </Card>
            </section>

            {/* Users & Teams */}
            <section id="users" className="scroll-mt-24 space-y-4">
              <div className="flex items-center justify-between">
                 <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                  <Users className="w-6 h-6 text-cyan-400" />
                  Users & Teams
                </h2>
                <a href="https://cms-dev.github.io/cms/Users.html" target="_blank" className="text-xs text-indigo-400 hover:text-indigo-300">Official Docs →</a>
              </div>
              <Card className="glass-card p-6 border-white/10 space-y-4">
                <div>
                   <h3 className="font-bold text-white mb-2">Teams</h3>
                   <p className="text-sm text-neutral-400">
                     Users are grouped into Teams (e.g., "IOI 2024", "Guest"). You can use teams to bulk-add users or filter scoreboards.
                   </p>
                </div>
                <div className="pt-4 border-t border-white/5">
                  <h3 className="font-bold text-white mb-2">Participation Settings</h3>
                  <p className="text-sm text-neutral-400 mb-4">
                    When a user is added to a contest, a "Participation" object is created to track their specific constraints.
                   </p>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-black/30 p-4 rounded-lg border border-white/5">
                      <span className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Time Adjustments</span>
                      <ul className="text-xs text-neutral-400 mt-2 space-y-2">
                        <li><strong className="text-neutral-300">Extra Time:</strong> Minutes added to the contest duration for this specific user.</li>
                        <li><strong className="text-neutral-300">Delay Time:</strong> Minutes this user must wait after the contest start before they can log in.</li>
                      </ul>
                     </div>
                    <div className="bg-black/30 p-4 rounded-lg border border-white/5">
                      <span className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Security Flags</span>
                      <ul className="text-xs text-neutral-400 mt-2 space-y-2">
                        <li><strong className="text-neutral-300">Unrestricted:</strong> Bypasses IP restrictions and submission rate limits.</li>
                        <li><strong className="text-neutral-300">Hidden:</strong> The user participates but is excluded from the public scoreboard and rankings.</li>
                      </ul>
                     </div>
                   </div>
                </div>
              </Card>
            </section>

             {/* Tasks (Existing content + expansion) */}
            <section id="tasks" className="scroll-mt-24 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                  <Code className="w-6 h-6 text-indigo-400" />
                  Tasks & Datasets
                </h2>
                <a href="https://cms-dev.github.io/cms/Task%20Types.html" target="_blank" className="text-xs text-indigo-400 hover:text-indigo-300">Official Docs →</a>
              </div>
              
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="glass-card p-6 border-white/10">
                  <h3 className="font-bold text-white mb-2 underline decoration-indigo-500/30">Task Types</h3>
                   <ul className="text-sm text-neutral-400 space-y-2 list-disc list-inside">
                    <li><strong className="text-white">Batch:</strong> Standard mode where a program reads input and produces output.</li>
                    <li><strong className="text-white">Communication:</strong> Two programs communicating with each other through a manager.</li>
                    <li><strong className="text-white">OutputOnly:</strong> No code submission; users upload pre-computed output files.</li>
                    <li><strong className="text-white">TwoSteps:</strong> Program is run twice (e.g., for header/library problems).</li>
                  </ul>
                </Card>
                 <Card className="glass-card p-6 border-white/10">
                  <h3 className="font-bold text-white mb-2 underline decoration-indigo-500/30">Datasets</h3>
                  <p className="text-sm text-neutral-400 mb-2">
                    A task can have multiple datasets, but only one is <strong>Active</strong>.
                  </p>
                  <p className="text-sm text-neutral-400">
                    <strong>Testcases:</strong> Input/Output pairs.<br/>
                    <strong>Managers:</strong> Custom checker/manager programs.<br/>
                    <strong>Limits:</strong> Time/Memory limits per dataset.
                  </p>
                </Card>
              </div>

              <Card className="glass-card p-6 border-white/10">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-3">
                    <h3 className="font-bold text-indigo-400 text-sm uppercase tracking-wider">Score Modes</h3>
                    <ul className="text-xs text-neutral-400 space-y-2">
                      <li><strong className="text-neutral-300">Max:</strong> Best score across all submissions.</li>
                      <li><strong className="text-neutral-300">Max_subtask:</strong> Best score per subtask across different submissions (mixed).</li>
                      <li><strong className="text-neutral-300">Max_tokened_last:</strong> Only the score of the last submission using a token counts.</li>
                    </ul>
                  </div>
                  <div className="space-y-3">
                    <h3 className="font-bold text-indigo-400 text-sm uppercase tracking-wider">Feedback Levels</h3>
                    <ul className="text-xs text-neutral-400 space-y-2">
                      <li><strong className="text-neutral-300">Restricted:</strong> User only sees the total score.</li>
                      <li><strong className="text-neutral-300">OI Restricted:</strong> User sees whether subtasks were correct/incorrect (no details).</li>
                      <li><strong className="text-neutral-300">Full:</strong> Detailed testcase feedback, execution time, and memory usage.</li>
                    </ul>
                  </div>
                  <div className="space-y-3">
                    <h3 className="font-bold text-indigo-400 text-sm uppercase tracking-wider">Score Types (Dataset)</h3>
                    <ul className="text-xs text-neutral-400 space-y-2">
                      <li><strong className="text-neutral-300">Sum:</strong> Final score is the sum of subtask scores.</li>
                      <li><strong className="text-neutral-300">GroupMin:</strong> All testcases in a group must pass to get the group points.</li>
                      <li><strong className="text-neutral-300">GroupMul:</strong> Scores from different groups are multiplied (rare).</li>
                    </ul>
                  </div>
                </div>
              </Card>

              <Card className="glass-card p-6 border-white/10">
                <div className="flex flex-col md:flex-row gap-8">
                    <div className="flex-1">
                    <h3 className="font-bold text-white mb-3 flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-indigo-400" />
                      The Token Generation System
                    </h3>
                    <p className="text-sm text-neutral-400 leading-relaxed">
                      Tokens control how often users can "test" their solutions against the full judge.
                      A bucket starts with <span className="text-white">Gen Initial</span> tokens.
                      Every <span className="text-white">Gen Interval</span> (minutes),
                      the user receives <span className="text-white">Gen Number</span> more tokens,
                      up to the <span className="text-white">Gen Max</span>.
                      </p>
                    </div>
                  <div className="flex-1 bg-black/40 p-4 rounded-xl border border-white/5">
                    <h4 className="text-xs font-bold text-neutral-500 uppercase mb-2">Example Config</h4>
                    <div className="text-xs font-mono text-indigo-300 space-y-1">
                      <div>Initial: 2</div>
                      <div>Gen Number: 1</div>
                      <div>Interval: 30 min</div>
                      <div>Max: 5</div>
                    </div>
                    <p className="text-[10px] text-neutral-500 mt-2 italic">
                      User starts with 2 tries. Every 30 mins they get 1 more, but can't hold more than 5 at once.
                      </p>
                    </div>
                  </div>
                </Card>
            </section>

             {/* Submissions */}
            <section id="submissions" className="scroll-mt-24 space-y-4">
               <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                  <Activity className="w-6 h-6 text-emerald-400" />
                  Submissions
                </h2>
              </div>
              <Card className="glass-card p-6 border-white/10">
                <p className="text-neutral-300 mb-6">
                  View centralized submission logs. You can filter by contest, task, or user to monitor real-time judge performance.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-2">
                    <h4 className="font-bold text-emerald-400 text-sm flex items-center gap-2">
                      <Activity className="w-4 h-4" />
                      Automatic Evaluation
                    </h4>
                    <p className="text-xs text-emerald-200/70 leading-relaxed">
                      Every submission undergoes compilation, execution, and comparison. Results are cached unless the underlying settings change.
                    </p>
                  </div>
                  <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-2">
                    <h4 className="font-bold text-amber-400 text-sm flex items-center gap-2">
                      <Flag className="w-4 h-4" />
                      Result Invalidation
                    </h4>
                    <p className="text-xs text-amber-200/70 leading-relaxed">
                      If you update a task's testcases or scoring rules, you must <strong className="text-amber-400">Invalidate</strong> existing results to force a re-evaluation on the next judge cycle.
                    </p>
                  </div>
                </div>
              </Card>
            </section>

             {/* Services */}
            <section id="services" className="scroll-mt-24 space-y-4">
               <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                  <Server className="w-6 h-6 text-purple-400" />
                  Services (Containers)
                </h2>
                 <a href="https://cms-dev.github.io/cms/Internals.html" target="_blank" className="text-xs text-indigo-400 hover:text-indigo-300">Official Docs →</a>
              </div>
              <Card className="glass-card p-6 border-white/10">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-white font-medium">LogService</h3>
                     <p className="text-sm text-neutral-400">Central logging facility. Collects logs from all other services.</p>
                  </div>
                   <div>
                    <h3 className="text-white font-medium">ResourceService</h3>
                     <p className="text-sm text-neutral-400">Manages resources (files) and distributes them to workers.</p>
                  </div>
                   <div>
                    <h3 className="text-white font-medium">EvaluationService / Worker</h3>
                     <p className="text-sm text-neutral-400">Handles the compilation and execution of user submissions.</p>
                  </div>
                   <div>
                    <h3 className="text-white font-medium">ContestWebServer (CWS) / AdminWebServer (AWS)</h3>
                     <p className="text-sm text-neutral-400">The frontend interfaces for participants and admins.</p>
                  </div>
                </div>
              </Card>
            </section>

          </div>
        </div>
      </main>
    </div>
  );
}
