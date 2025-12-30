import { AlertCircle, Book, CheckCircle, Code, HelpCircle, Terminal, Users, Flag, Trophy, Server, Activity } from 'lucide-react';
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
                    <h3 className="font-medium text-white mb-2">Timing</h3>
                    <ul className="text-sm text-neutral-400 space-y-2">
                       <li><strong className="text-neutral-300">Start/Stop:</strong> The window when users can submit.</li>
                       <li><strong className="text-neutral-300">Analysis Mode:</strong> Post-contest period where users can see results and unofficial submissions are allowed (if enabled).</li>
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-medium text-white mb-2">Access Control</h3>
                    <ul className="text-sm text-neutral-400 space-y-2">
                       <li><strong className="text-neutral-300">IP Restriction:</strong> Limit login to specific IPs (configured in Participations).</li>
                       <li><strong className="text-neutral-300">Token Mode:</strong> Control submission frequency (Disabled, Infinite, or limited).</li>
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
                   <h3 className="font-bold text-white mb-2">Users</h3>
                   <p className="text-sm text-neutral-400 mb-2">
                     Participants in the contest. 
                   </p>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="bg-black/30 p-3 rounded-lg">
                       <span className="text-xs font-bold text-neutral-500 uppercase">Authentication</span>
                       <p className="text-sm text-neutral-300 mt-1">Username/Password or IP-based autologin.</p>
                     </div>
                     <div className="bg-black/30 p-3 rounded-lg">
                       <span className="text-xs font-bold text-neutral-500 uppercase">Timezone</span>
                       <p className="text-sm text-neutral-300 mt-1">Users can have individual timezones.</p>
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
                  <h3 className="font-bold text-white mb-2">Task Types</h3>
                   <ul className="text-sm text-neutral-400 space-y-2 list-disc list-inside">
                    <li><strong className="text-white">Batch:</strong> Source code vs Testcases.</li>
                    <li><strong className="text-white">Communication:</strong> Interaction with manager.</li>
                    <li><strong className="text-white">OutputOnly:</strong> Submit output files.</li>
                    <li><strong className="text-white">TwoSteps:</strong> Two-pass execution.</li>
                  </ul>
                </Card>
                 <Card className="glass-card p-6 border-white/10">
                  <h3 className="font-bold text-white mb-2">Datasets</h3>
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
                  <div className="flex items-start gap-4">
                    <div className="flex-1">
                      <h3 className="font-bold text-white mb-1">Score Types</h3>
                      <p className="text-sm text-neutral-400">
                         Sum, GroupMin, GroupMul. How testcase scores are aggregated.
                      </p>
                    </div>
                     <div className="flex-1">
                      <h3 className="font-bold text-white mb-1">Token Gen</h3>
                      <p className="text-sm text-neutral-400">
                         Controls how many test tokens users get and how fast they regenerate (for testing their solutions during contest).
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
                <p className="text-neutral-300 mb-4">
                   View centralized submission logs. You can filter by contest, task, or user.
                </p>
                 <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                  <h4 className="font-bold text-emerald-400 text-sm mb-1 flex items-center gap-2">
                    <Flag className="w-4 h-4" />
                    Rejudging
                  </h4>
                  <p className="text-xs text-emerald-200/80">
                    When you update a dataset or task settings, existing submissions are NOT automatically rejudged. 
                    You must invalidating the submission results.
                     (Note: Currently implemented via re-uploading testcases or explicit admin actions).
                  </p>
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
