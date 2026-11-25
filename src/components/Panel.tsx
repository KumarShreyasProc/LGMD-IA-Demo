import type { ReactNode } from 'react';

export function Panel({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <h3 className="panel-title">{title}</h3>
      <div className="panel-body">{children}</div>
    </section>
  );
}
