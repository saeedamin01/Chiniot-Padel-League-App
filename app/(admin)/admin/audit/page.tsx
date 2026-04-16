'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AuditLog, Player } from '@/types'
import { formatDateTime, formatTimeAgo } from '@/lib/utils'
import { Download, ChevronDown, ChevronUp } from 'lucide-react'

interface AuditRow extends AuditLog {
  actor?: Player
}

export default function AuditPage() {
  const supabase = createClient()
  const [logs, setLogs] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [totalCount, setTotalCount] = useState(0)
  const [filterAction, setFilterAction] = useState('all')
  const [filterAdmin, setFilterAdmin] = useState('all')
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [admins, setAdmins] = useState<Player[]>([])

  useEffect(() => {
    loadAuditLog()
    loadAdmins()
  }, [page, filterAction, filterAdmin])

  async function loadAdmins() {
    try {
      const { data } = await supabase
        .from('players')
        .select('*')
        .eq('is_admin', true)
      setAdmins(data || [])
    } catch (err) {
      console.error('Error loading admins:', err)
    }
  }

  async function loadAuditLog() {
    try {
      setLoading(true)

      let query = supabase
        .from('audit_log')
        .select('*, actor:players!actor_id(*)', { count: 'exact' })
        .order('created_at', { ascending: false })

      if (filterAction !== 'all') {
        query = query.eq('action_type', filterAction)
      }

      if (filterAdmin !== 'all') {
        query = query.eq('actor_id', filterAdmin)
      }

      const offset = (page - 1) * pageSize
      query = query.range(offset, offset + pageSize - 1)

      const { data, count } = await query

      setLogs(data || [])
      setTotalCount(count || 0)
    } catch (err) {
      console.error('Error loading audit log:', err)
    } finally {
      setLoading(false)
    }
  }

  function toggleRowExpanded(id: string) {
    const newExpanded = new Set(expandedRows)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedRows(newExpanded)
  }

  async function handleExportCSV() {
    try {
      const { data } = await supabase
        .from('audit_log')
        .select('*, actor:players!actor_id(*)')
        .order('created_at', { ascending: false })

      if (!data) return

      const csv = [
        ['Timestamp', 'Admin', 'Action', 'Entity Type', 'Entity ID', 'Notes'].join(','),
        ...data.map((log) =>
          [
            new Date(log.created_at).toLocaleString(),
            log.actor_email,
            log.action_type,
            log.entity_type,
            log.entity_id || '',
            (log.notes || '').replace(/,/g, ';'),
          ].join(',')
        ),
      ].join('\n')

      const blob = new Blob([csv], { type: 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`
      a.click()
    } catch (err) {
      console.error('Error exporting CSV:', err)
    }
  }

  const totalPages = Math.ceil(totalCount / pageSize)
  const actionTypes = [...new Set(logs.map(l => l.action_type))]

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-slate-400">Loading audit log...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-white">Audit Log</h1>
        <Button
          onClick={handleExportCSV}
          variant="outline"
          className="text-emerald-400 border-emerald-500/50 hover:bg-emerald-500/10"
        >
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <Select value={filterAction} onValueChange={setFilterAction}>
          <SelectTrigger className="bg-slate-800 border-slate-700 text-white w-40">
            <SelectValue placeholder="All Actions" />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-700">
            <SelectItem value="all">All Actions</SelectItem>
            {actionTypes.map((action) => (
              <SelectItem key={action} value={action}>
                {action}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterAdmin} onValueChange={setFilterAdmin}>
          <SelectTrigger className="bg-slate-800 border-slate-700 text-white w-40">
            <SelectValue placeholder="All Admins" />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-700">
            <SelectItem value="all">All Admins</SelectItem>
            {admins.map((admin) => (
              <SelectItem key={admin.id} value={admin.id}>
                {admin.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Audit Log Table */}
      <Card className="bg-slate-800/60 border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-900/50 border-slate-700">
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead className="text-slate-300">Timestamp</TableHead>
                <TableHead className="text-slate-300">Admin</TableHead>
                <TableHead className="text-slate-300">Action</TableHead>
                <TableHead className="text-slate-300">Entity</TableHead>
                <TableHead className="text-slate-300 text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <>
                  <TableRow
                    key={log.id}
                    className="border-slate-700 cursor-pointer hover:bg-slate-700/50"
                    onClick={() => toggleRowExpanded(log.id)}
                  >
                    <TableCell>
                      {log.old_value || log.new_value ? (
                        expandedRows.has(log.id) ? (
                          <ChevronUp className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-500" />
                        )
                      ) : null}
                    </TableCell>
                    <TableCell className="text-slate-300 text-sm">
                      {formatDateTime(log.created_at)}
                    </TableCell>
                    <TableCell className="text-slate-300">
                      {log.actor_email || 'System'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                      >
                        {log.action_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-300 text-sm">
                      <div>{log.entity_type}</div>
                      {log.entity_id && (
                        <div className="text-xs text-slate-500 font-mono">{log.entity_id}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-slate-400 text-sm">
                      {formatTimeAgo(log.created_at)}
                    </TableCell>
                  </TableRow>

                  {expandedRows.has(log.id) && (log.old_value || log.new_value) && (
                    <TableRow className="bg-slate-900/30 border-slate-700">
                      <TableCell colSpan={6} className="p-4">
                        <div className="space-y-3">
                          {log.old_value && (
                            <div>
                              <div className="text-xs font-medium text-red-400 mb-1">OLD VALUE</div>
                              <pre className="bg-slate-900/50 p-3 rounded text-xs text-slate-300 overflow-auto max-h-48">
                                {JSON.stringify(log.old_value, null, 2)}
                              </pre>
                            </div>
                          )}
                          {log.new_value && (
                            <div>
                              <div className="text-xs font-medium text-emerald-400 mb-1">NEW VALUE</div>
                              <pre className="bg-slate-900/50 p-3 rounded text-xs text-slate-300 overflow-auto max-h-48">
                                {JSON.stringify(log.new_value, null, 2)}
                              </pre>
                            </div>
                          )}
                          {log.notes && (
                            <div>
                              <div className="text-xs font-medium text-slate-300 mb-1">NOTES</div>
                              <p className="text-xs text-slate-400">{log.notes}</p>
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Pagination */}
      <div className="flex justify-between items-center">
        <div className="text-sm text-slate-400">
          Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, totalCount)} of {totalCount} entries
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            className="text-slate-300 border-slate-600 hover:bg-slate-800"
          >
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={page === totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            className="text-slate-300 border-slate-600 hover:bg-slate-800"
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
