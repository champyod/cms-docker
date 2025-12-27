'use client';

import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/core/Table';
import { Button } from '@/components/core/Button';
import { Edit2, Trash2, Plus, Users } from 'lucide-react';
import { updateTeam, deleteTeam } from '@/app/actions/teams';
import { TeamModal } from './TeamModal';

interface TeamWithCount {
  id: number;
  code: string;
  name: string;
  _count: { participations: number };
}

export function TeamList({ initialTeams }: { initialTeams: TeamWithCount[] }) {
  const [teams] = useState(initialTeams);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamWithCount | null>(null);

  const handleDelete = async (id: number) => {
    if (confirm('Delete this team?')) {
      const result = await deleteTeam(id);
      if (result.success) {
        window.location.reload();
      } else {
        alert(result.error);
      }
    }
  };

  const startEdit = (team: TeamWithCount) => {
    setEditingTeam(team);
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-white">All Teams</h2>
        <Button 
          variant="primary" 
          className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white pl-3 pr-4"
          onClick={() => setIsModalOpen(true)}
        >
          <Plus className="w-4 h-4" />
          Add Team
        </Button>
      </div>



      <div className="border border-white/5 rounded-xl overflow-hidden bg-neutral-900/40">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-white/5 hover:bg-white/5">
              <TableHead className="text-neutral-400">ID</TableHead>
              <TableHead className="text-neutral-400">Code</TableHead>
              <TableHead className="text-neutral-400">Name</TableHead>
              <TableHead className="text-neutral-400">Members</TableHead>
              <TableHead className="text-neutral-400 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {teams.map((team) => (
              <TableRow key={team.id} className="border-b border-white/5 hover:bg-white/5">
                <TableCell className="font-mono text-neutral-500 text-xs">#{team.id}</TableCell>
                <TableCell className="font-mono text-indigo-400 text-sm">{team.code}</TableCell>
                <TableCell className="font-medium text-white">{team.name}</TableCell>
                <TableCell className="text-neutral-400 text-sm">{team._count.participations}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => startEdit(team)} className="h-8 w-8 p-0 text-neutral-400 hover:text-indigo-400">
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(team.id)} className="h-8 w-8 p-0 text-neutral-400 hover:text-red-400">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {teams.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-neutral-500">
                  No teams found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <TeamModal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setEditingTeam(null); }}
        onSuccess={() => window.location.reload()}
        initialData={editingTeam}
      />
    </div>
  );
}
