'use client';

import { useState } from 'react';

import { createAlert } from '@/app/operator/actions';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { buttonClass, inputClass } from '@/components/ui';
import type { AlertSeverity } from '@/lib/types/database';

const TEMPLATES: { label: string; title: string; message: string; severity: AlertSeverity }[] = [
  { label: 'Route delayed', title: 'Route temporarily delayed', message: 'Buses on this route are running late. Please allow extra time.', severity: 'warning' },
  { label: 'Disruption', title: 'Service disruption on this route', message: 'Service on this route is disrupted. Expect gaps between buses.', severity: 'critical' },
  { label: 'Behind schedule', title: 'Bus service running behind schedule', message: 'Some buses are running behind schedule. Check live arrival times before you travel.', severity: 'info' },
];

export function AlertForm({ routes }: { routes: { id: string; code: string; name: string }[] }) {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<AlertSeverity>('warning');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <span className="self-center text-xs opacity-60">Templates:</span>
        {TEMPLATES.map((t) => (
          <button
            key={t.label}
            type="button"
            className={buttonClass}
            onClick={() => {
              setTitle(t.title);
              setMessage(t.message);
              setSeverity(t.severity);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ActionForm action={createAlert} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          Title
          <input name="title" required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          Message shown to passengers
          <textarea name="message" required minLength={3} maxLength={500} rows={2} value={message} onChange={(e) => setMessage(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Route
          <select name="route_id" defaultValue="" className={inputClass}>
            <option value="">All routes (network-wide)</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>{r.code} · {r.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Severity
          <select name="severity" value={severity} onChange={(e) => setSeverity(e.target.value as AlertSeverity)} className={inputClass}>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Show for
          <select name="duration_min" defaultValue="60" className={inputClass}>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
            <option value="180">3 hours</option>
            <option value="0">Until switched off</option>
          </select>
        </label>
        <div className="flex items-end">
          <SubmitButton primary>Publish alert</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
