'use client';

import Link from 'next/link';
import { Book, Code, Terminal, Users, Flag, Trophy, Server, Activity, Cpu } from 'lucide-react';
import { Card } from '@/components/core/Card';

interface DocsContentProperties {
  title: string;
  subtitle: string;
  officialDocsLabel: string;
}

export function DocsContent({ title, subtitle, officialDocsLabel }: DocsContentProperties): React.JSX.Element {
  return (
    <div className="flex min-h-screen overflow-hidden bg-background">
      <main className="flex flex-1 flex-col overflow-hidden relative">
        <div className="absolute top-0 left-0 w-full h-96 bg-indigo-600/10 blur-3xl rounded-full pointer-events-none -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-cyan-600/5 blur-2xl rounded-full pointer-events-none translate-y-1/2" />

        <div className="flex-1 overflow-y-auto p-8 z-10 scrollbar-thin scrollbar-thumb-border hover:scrollbar-thumb-muted-foreground/40">
          <div className="max-w-5xl mx-auto space-y-12">
            <DocsHeader title={title} subtitle={subtitle} officialDocsLabel={officialDocsLabel} />
            <DocsNavigationGrid />
            <ContestsSection />
            <UsersSection />
            <TasksSection />
            <SubmissionsSection />
            <ServicesSection />
          </div>
        </div>
      </main>
    </div>
  );
}

function DocsHeader({ title, subtitle, officialDocsLabel }: DocsContentProperties): React.JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-border pb-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">{title}</h1>
        <p className="text-muted-foreground">{subtitle}</p>
      </div>
      <a
        href="https://cms-dev.github.io/cms/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary/80 text-foreground rounded-lg transition-colors border border-border"
      >
        <Book className="h-4 w-4" />
        {officialDocsLabel}
      </a>
    </div>
  );
}

function DocsNavigationGrid(): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      <Link href="#contests" className="p-4 bg-card hover:bg-accent rounded-xl border border-border transition-colors group">
        <Trophy className="h-6 w-6 text-amber-400 mb-2 group-hover:scale-110 transition-transform" />
        <span className="font-medium text-foreground block">Contests</span>
        <span className="text-xs text-muted-foreground">Configuration and Timing</span>
      </Link>
      <Link href="#users" className="p-4 bg-card hover:bg-accent rounded-xl border border-border transition-colors group">
        <Users className="h-6 w-6 text-cyan-400 mb-2 group-hover:scale-110 transition-transform" />
        <span className="font-medium text-foreground block">Users and Teams</span>
        <span className="text-xs text-muted-foreground">Authentication and Groups</span>
      </Link>
      <Link href="#tasks" className="p-4 bg-card hover:bg-accent rounded-xl border border-border transition-colors group">
        <Code className="h-6 w-6 text-indigo-400 mb-2 group-hover:scale-110 transition-transform" />
        <span className="font-medium text-foreground block">Tasks</span>
        <span className="text-xs text-muted-foreground">Problems, Datasets, Tests</span>
      </Link>
      <Link href="#submissions" className="p-4 bg-card hover:bg-accent rounded-xl border border-border transition-colors group">
        <Activity className="h-6 w-6 text-emerald-400 mb-2 group-hover:scale-110 transition-transform" />
        <span className="font-medium text-foreground block">Submissions</span>
        <span className="text-xs text-muted-foreground">Monitoring and Rejudging</span>
      </Link>
      <Link href="#services" className="p-4 bg-card hover:bg-accent rounded-xl border border-border transition-colors group">
        <Server className="h-6 w-6 text-purple-400 mb-2 group-hover:scale-110 transition-transform" />
        <span className="font-medium text-foreground block">Services</span>
        <span className="text-xs text-muted-foreground">Status and Logs</span>
      </Link>
    </div>
  );
}

function ContestsSection(): React.JSX.Element {
  return (
    <section id="contests" className="scroll-mt-24 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <Trophy className="h-6 w-6 text-amber-400" />
          Contests
        </h2>
        <a href="https://cms-dev.github.io/cms/Contest%20Definition.html" target="_blank" className="text-xs text-indigo-400 hover:text-indigo-300">
          Official Docs →
        </a>
      </div>
      <Card className="p-6">
        <p className="text-foreground mb-4">A contest is the main container for tasks and users. You can define start and stop times, allowed languages, and participation rules.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-medium text-foreground mb-2 underline decoration-indigo-500/30">Contest Timing</h3>
            <ul className="text-sm text-muted-foreground space-y-3">
              <li>
                <strong className="text-foreground">Start and Stop Time:</strong>
                <p className="text-xs mt-1">The UTC interval when the contest is active. Submissions outside this window are rejected.</p>
              </li>
              <li>
                <strong className="text-foreground">Analysis Mode:</strong>
                <p className="text-xs mt-1">An optional period after Stop Time where contestants can view detailed results.</p>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-foreground mb-2 underline decoration-indigo-500/30">Submission Limits</h3>
            <ul className="text-sm text-muted-foreground space-y-3">
              <li>
                <strong className="text-foreground">Token Mode:</strong>
                <p className="text-xs mt-1">
                  <span className="text-indigo-400">• Disabled:</span> No tokens used.
                  <br />
                  <span className="text-indigo-400">• Infinite:</span> Unlimited tokens.
                  <br />
                  <span className="text-indigo-400">• Limited:</span> Bucket system where tokens regenerate over time.
                </p>
              </li>
              <li>
                <strong className="text-foreground">Minimum Interval:</strong>
                <p className="text-xs mt-1">Forces a wait time in seconds between consecutive submissions.</p>
              </li>
            </ul>
          </div>
        </div>
      </Card>
    </section>
  );
}

function UsersSection(): React.JSX.Element {
  return (
    <section id="users" className="scroll-mt-24 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <Users className="h-6 w-6 text-cyan-400" />
          Users and Teams
        </h2>
        <a href="https://cms-dev.github.io/cms/Users.html" target="_blank" className="text-xs text-indigo-400 hover:text-indigo-300">
          Official Docs →
        </a>
      </div>
      <Card className="p-6 space-y-4">
        <div>
          <h3 className="font-bold text-foreground mb-2">Teams</h3>
          <p className="text-sm text-muted-foreground">Users are grouped into Teams. You can use teams to bulk add users or filter scoreboards.</p>
        </div>
        <div className="pt-4 border-t border-border">
          <h3 className="font-bold text-foreground mb-2">Participation Settings</h3>
          <p className="text-sm text-muted-foreground mb-4">When a user is added to a contest, a Participation object tracks specific constraints.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-muted/50 p-4 rounded-lg border border-border">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Time Adjustments</span>
              <ul className="text-xs text-muted-foreground mt-2 space-y-2">
                <li>
                  <strong className="text-foreground">Extra Time:</strong> Minutes added to contest duration.
                </li>
                <li>
                  <strong className="text-foreground">Delay Time:</strong> Minutes before user can log in after contest start.
                </li>
              </ul>
            </div>
            <div className="bg-muted/50 p-4 rounded-lg border border-border">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Security Flags</span>
              <ul className="text-xs text-muted-foreground mt-2 space-y-2">
                <li>
                  <strong className="text-foreground">Unrestricted:</strong> Bypasses IP restrictions and rate limits.
                </li>
                <li>
                  <strong className="text-foreground">Hidden:</strong> Excluded from public scoreboard and rankings.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}

function TasksSection(): React.JSX.Element {
  return (
    <section id="tasks" className="scroll-mt-24 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <Code className="h-6 w-6 text-indigo-400" />
          Tasks and Datasets
        </h2>
        <a href="https://cms-dev.github.io/cms/Task%20Types.html" target="_blank" className="text-xs text-indigo-400 hover:text-indigo-300">
          Official Docs →
        </a>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-6">
          <h3 className="font-bold text-foreground mb-2 underline decoration-indigo-500/30">Task Types</h3>
          <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
            <li>
              <strong className="text-foreground">Batch:</strong> Standard mode where program reads input and produces output.
            </li>
            <li>
              <strong className="text-foreground">Communication:</strong> Two programs communicating through a manager.
            </li>
            <li>
              <strong className="text-foreground">OutputOnly:</strong> No code submission; users upload precomputed output files.
            </li>
            <li>
              <strong className="text-foreground">TwoSteps:</strong> Program run twice.
            </li>
          </ul>
          <div className="mt-4 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
            <h4 className="font-bold text-indigo-400 text-xs uppercase tracking-wider mb-2 flex items-center gap-2">
              <Terminal className="h-3 w-3" />
              Manager Files
            </h4>
            <div className="space-y-3">
              <div>
                <code className="text-xs bg-muted px-1 py-0.5 rounded text-amber-200">checker</code>
                <p className="text-xs text-muted-foreground mt-1">Source file that validates output.</p>
              </div>
              <div>
                <code className="text-xs bg-muted px-1 py-0.5 rounded text-amber-200">grader</code>
                <p className="text-xs text-muted-foreground mt-1">Driver program for communication tasks.</p>
              </div>
            </div>
          </div>
        </Card>
        <Card className="p-6">
          <h3 className="font-bold text-foreground mb-2 underline decoration-indigo-500/30">Datasets</h3>
          <p className="text-sm text-muted-foreground mb-2">A task can have multiple datasets, but only one is Active.</p>
          <p className="text-sm text-muted-foreground">Testcases: Input and Output pairs. Managers: Custom checker programs. Limits: Time and Memory per dataset.</p>
          <div className="mt-4 pt-4 border-t border-border space-y-3">
            <h4 className="font-bold text-foreground text-xs uppercase tracking-wider">Common Fields</h4>
            <ul className="text-xs text-muted-foreground space-y-2">
              <li>
                <strong className="text-foreground">Time Limit:</strong> Maximum CPU time allowed per testcase.
              </li>
              <li>
                <strong className="text-foreground">Memory Limit:</strong> Maximum address space allowed.
              </li>
            </ul>
          </div>
        </Card>
      </div>
      <Card className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-3">
            <h3 className="font-bold text-indigo-400 text-sm uppercase tracking-wider">Score Modes</h3>
            <ul className="text-xs text-muted-foreground space-y-2">
              <li>
                <strong className="text-foreground">Max:</strong> Best score across all submissions.
              </li>
              <li>
                <strong className="text-foreground">Max subtask:</strong> Best per subtask across submissions.
              </li>
            </ul>
          </div>
          <div className="space-y-3">
            <h3 className="font-bold text-indigo-400 text-sm uppercase tracking-wider">Feedback Levels</h3>
            <ul className="text-xs text-muted-foreground space-y-2">
              <li>
                <strong className="text-foreground">Restricted:</strong> User sees total score only.
              </li>
              <li>
                <strong className="text-foreground">Full:</strong> Detailed testcase feedback and metrics.
              </li>
            </ul>
          </div>
          <div className="space-y-3">
            <h3 className="font-bold text-indigo-400 text-sm uppercase tracking-wider">Score Types</h3>
            <ul className="text-xs text-muted-foreground space-y-2">
              <li>
                <strong className="text-foreground">Sum:</strong> Sum of subtask scores.
              </li>
              <li>
                <strong className="text-foreground">GroupMin:</strong> All testcases in group must pass.
              </li>
            </ul>
          </div>
        </div>
      </Card>
    </section>
  );
}

function SubmissionsSection(): React.JSX.Element {
  return (
    <section id="submissions" className="scroll-mt-24 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <Activity className="h-6 w-6 text-emerald-400" />
          Submissions
        </h2>
      </div>
      <Card className="p-6">
        <p className="text-foreground mb-6">View centralized submission logs. Filter by contest, task, or user to monitor judge performance.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl space-y-2">
            <h4 className="font-bold text-emerald-400 text-sm flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Automatic Evaluation
            </h4>
            <p className="text-xs text-emerald-200/70 leading-relaxed">Every submission undergoes compilation, execution, and comparison.</p>
          </div>
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl space-y-2">
            <h4 className="font-bold text-amber-400 text-sm flex items-center gap-2">
              <Flag className="h-4 w-4" />
              Result Invalidation
            </h4>
            <p className="text-xs text-amber-200/70 leading-relaxed">If you update testcases or scoring rules, invalidate existing results to force reevaluation.</p>
          </div>
        </div>
      </Card>
    </section>
  );
}

function ServicesSection(): React.JSX.Element {
  return (
    <section id="services" className="scroll-mt-24 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-3">
          <Server className="h-6 w-6 text-purple-400" />
          Services
        </h2>
        <a href="https://cms-dev.github.io/cms/Internals.html" target="_blank" className="text-xs text-indigo-400 hover:text-indigo-300">
          Official Docs →
        </a>
      </div>
      <Card className="p-6">
        <div className="space-y-4">
          <div>
            <h3 className="text-foreground font-medium">LogService</h3>
            <p className="text-sm text-muted-foreground">Central logging facility.</p>
          </div>
          <div>
            <h3 className="text-foreground font-medium">ResourceService</h3>
            <p className="text-sm text-muted-foreground">Manages resources and distributes them to workers.</p>
          </div>
          <div>
            <h3 className="text-foreground font-medium">EvaluationService</h3>
            <p className="text-sm text-muted-foreground">Handles compilation and execution of submissions.</p>
          </div>
        </div>
      </Card>
    </section>
  );
}
