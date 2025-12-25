import React from 'react';
import { Card } from '@/components/core/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { Button } from '@/components/core/Button';
import { Activity, Users, Trophy, Server } from 'lucide-react';

const StatCard = ({ title, value, change, icon: Icon, color }: { title: string; value: string; change: string | number; icon: React.ComponentType<{ className?: string }>; color: string }) => (
  <Card className="relative overflow-hidden group">
    <div className={`absolute right-4 top-4 p-3 rounded-2xl ${color} bg-opacity-20 text-white`}>
      <Icon className="w-6 h-6" />
    </div>
    <div className="relative z-10">
      <p className="text-slate-400 text-sm font-medium mb-1">{title}</p>
      <h3 className="text-3xl font-bold text-white mb-2">{value}</h3>
      <p className="text-sm font-medium text-emerald-400 flex items-center gap-1">
        +{change}% 
        <span className="text-slate-500 font-normal">from last month</span>
      </p>
    </div>
    <div className={`absolute -right-6 -bottom-6 w-32 h-32 rounded-full ${color} opacity-10 blur-2xl group-hover:scale-125 transition-transform duration-500`} />
  </Card>
);

export default function DashboardPage() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Active Users" value="2,543" change="12.5" icon={Users} color="bg-indigo-500" />
        <StatCard title="Total Contests" value="45" change="8.2" icon={Trophy} color="bg-amber-500" />
        <StatCard title="System Load" value="24%" change="2.1" icon={Activity} color="bg-emerald-500" />
        <StatCard title="Active Workers" value="12" change="0.0" icon={Server} color="bg-cyan-500" />
      </div>

      {/* Recent Activity Table */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Recent Contests</h2>
          <Button variant="ghost" size="sm">View All</Button>
        </div>
        
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contest Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Participants</TableHead>
              <TableHead>Start Time</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[1, 2, 3].map((i) => (
              <TableRow key={i}>
                <TableCell className="font-medium text-white">IOI Selection Round {i}</TableCell>
                <TableCell>
                  <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                    Running
                  </span>
                </TableCell>
                <TableCell>124</TableCell>
                <TableCell>2024-12-25 10:00</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm">Details</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

       {/* Quick Actions (Grid of Cards) */}
       <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="hover:border-indigo-500/50 cursor-pointer group glass-card-hover">
             <h3 className="text-lg font-bold text-white mb-2 group-hover:text-indigo-400 transition-colors">Create Contest</h3>
             <p className="text-slate-400 text-sm">Setup a new programming contest with custom rules.</p>
          </Card>
          <Card className="hover:border-indigo-500/50 cursor-pointer group glass-card-hover">
             <h3 className="text-lg font-bold text-white mb-2 group-hover:text-indigo-400 transition-colors">Manage Users</h3>
             <p className="text-slate-400 text-sm">Add, remove, or modify user permissions.</p>
          </Card>
           <Card className="hover:border-indigo-500/50 cursor-pointer group glass-card-hover">
             <h3 className="text-lg font-bold text-white mb-2 group-hover:text-indigo-400 transition-colors">System Logs</h3>
             <p className="text-slate-400 text-sm">View system health and error reports.</p>
          </Card>
       </div>
    </div>
  );
}
