"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { cx } from "@/lib/classes";
import { moneyShort, num, rValue, shortDate } from "@/lib/format";

/**
 * Wykresy. Jedna wspolna paleta, jeden zestaw osi, jeden styl podpowiedzi -
 * dzieki temu kazdy wykres w aplikacji czyta sie tak samo.
 * Zielen i czerwien wystepuja wylacznie tam, gdzie znacza zysk i strate.
 */

const OS = {
  stroke: "var(--color-line)",
  tick: { fill: "var(--color-faint)", fontSize: 11 },
  axisLine: false as const,
  tickLine: false as const,
};

function Box({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line-strong bg-surface-3 px-2.5 py-2 text-xs shadow-[var(--shadow-pop)]">
      {children}
    </div>
  );
}

type TooltipRow = { label: string; value: string; tone?: string };

function TooltipBox({ title, rows }: { title?: string; rows: TooltipRow[] }) {
  return (
    <Box>
      {title && <p className="mb-1 font-medium text-text">{title}</p>}
      {rows.map((r) => (
        <p key={r.label} className="liczba flex items-baseline justify-between gap-4">
          <span className="text-faint">{r.label}</span>
          <span className={cx("text-text", r.tone)}>{r.value}</span>
        </p>
      ))}
    </Box>
  );
}

export type EquityPointData = {
  index: number;
  equity: number;
  equityR: number;
  drawdown: number;
  day: string | null;
};

/** Krzywa kapitalu z podwykresem obsuniecia pod spodem. */
export function EquityChart({
  points,
  unit,
  currency,
  height = 260,
}: {
  points: EquityPointData[];
  unit: "cash" | "r";
  currency: string;
  height?: number;
}) {
  const key = unit === "cash" ? "equity" : "equityR";
  const format = (w: number) => (unit === "cash" ? moneyShort(w, currency) : `${num(w, 1)}R`);

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gradKapital" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={OS.stroke} vertical={false} />
          <XAxis
            dataKey="index"
            tick={OS.tick}
            axisLine={OS.axisLine}
            tickLine={OS.tickLine}
            minTickGap={28}
          />
          <YAxis
            tick={OS.tick}
            axisLine={OS.axisLine}
            tickLine={OS.tickLine}
            width={64}
            tickFormatter={format}
          />
          <Tooltip
            cursor={{ stroke: "var(--color-line-strong)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as EquityPointData;
              return (
                <TooltipBox
                  title={p.day ? shortDate(p.day) : `Trade ${p.index}`}
                  rows={[
                    { label: "Kapitał", value: format(unit === "cash" ? p.equity : p.equityR) },
                    {
                      label: "Obsunięcie",
                      value: unit === "cash" ? moneyShort(-p.drawdown, currency) : "—",
                      tone: p.drawdown > 0 ? "text-loss" : undefined,
                    },
                  ]}
                />
              );
            }}
          />
          <Area
            type="monotone"
            dataKey={key}
            stroke="var(--color-accent)"
            strokeWidth={2}
            fill="url(#gradKapital)"
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      <ResponsiveContainer width="100%" height={72}>
        <AreaChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="index" hide />
          <YAxis
            tick={OS.tick}
            axisLine={OS.axisLine}
            tickLine={OS.tickLine}
            width={64}
            tickFormatter={(w: number) => moneyShort(-w, currency)}
          />
          <Area
            type="monotone"
            dataKey="drawdown"
            stroke="var(--color-loss)"
            strokeWidth={1.5}
            fill="var(--color-loss)"
            fillOpacity={0.14}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      <p className="px-1 pt-1 text-xs text-faint">
        Dolny wykres to obsunięcie od szczytu kapitału.
      </p>
    </div>
  );
}

/** Rozklad wynikow w R. Slupki po lewej od zera sa strata, po prawej zyskiem. */
export function RHistogram({
  data,
  height = 220,
}: {
  data: { bucket: number; label: string; count: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={OS.stroke} vertical={false} />
        <XAxis dataKey="label" tick={OS.tick} axisLine={OS.axisLine} tickLine={OS.tickLine} />
        <YAxis
          tick={OS.tick}
          axisLine={OS.axisLine}
          tickLine={OS.tickLine}
          width={32}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ fill: "var(--color-surface-2)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as { label: string; count: number };
            return <TooltipBox title={p.label} rows={[{ label: "Trade'y", value: String(p.count) }]} />;
          }}
        />
        <Bar dataKey="count" isAnimationActive={false} radius={[2, 2, 0, 0]}>
          {data.map((d) => (
            <Cell
              key={d.bucket}
              fill={d.bucket < 0 ? "var(--color-loss)" : "var(--color-profit)"}
              fillOpacity={0.85}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Slupki wyniku dziennego. */
export function DailyBars({
  data,
  currency,
  height = 200,
}: {
  data: { day: string; pnl: number; count: number }[];
  currency: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={OS.stroke} vertical={false} />
        <XAxis
          dataKey="day"
          tick={OS.tick}
          axisLine={OS.axisLine}
          tickLine={OS.tickLine}
          tickFormatter={shortDate}
          minTickGap={24}
        />
        <YAxis
          tick={OS.tick}
          axisLine={OS.axisLine}
          tickLine={OS.tickLine}
          width={64}
          tickFormatter={(w: number) => moneyShort(w, currency)}
        />
        <ReferenceLine y={0} stroke="var(--color-line-strong)" />
        <Tooltip
          cursor={{ fill: "var(--color-surface-2)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as { day: string; pnl: number; count: number };
            return (
              <TooltipBox
                title={shortDate(p.day)}
                rows={[
                  {
                    label: "Wynik",
                    value: moneyShort(p.pnl, currency),
                    tone: p.pnl >= 0 ? "text-profit" : "text-loss",
                  },
                  { label: "Trade'y", value: String(p.count) },
                ]}
              />
            );
          }}
        />
        <Bar dataKey="pnl" isAnimationActive={false} radius={[2, 2, 0, 0]}>
          {data.map((d) => (
            <Cell key={d.day} fill={d.pnl >= 0 ? "var(--color-profit)" : "var(--color-loss)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** MAE wzgledem MFE - do kalibracji stopow i celow. */
export function MaeMfeScatter({
  data,
  height = 260,
}: {
  data: { maeR: number; mfeR: number; rMultiple: number | null; id: number }[];
  height?: number;
}) {
  const wins = data.filter((d) => (d.rMultiple ?? 0) >= 0);
  const losses = data.filter((d) => (d.rMultiple ?? 0) < 0);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
        <CartesianGrid stroke={OS.stroke} />
        <XAxis
          type="number"
          dataKey="maeR"
          name="MAE"
          tick={OS.tick}
          axisLine={OS.axisLine}
          tickLine={OS.tickLine}
          tickFormatter={(w: number) => `${num(w, 1)}R`}
          label={{ value: "MAE (R)", position: "insideBottom", offset: -4, fill: "var(--color-faint)", fontSize: 11 }}
        />
        <YAxis
          type="number"
          dataKey="mfeR"
          name="MFE"
          tick={OS.tick}
          axisLine={OS.axisLine}
          tickLine={OS.tickLine}
          width={48}
          tickFormatter={(w: number) => `${num(w, 1)}R`}
        />
        <ZAxis range={[36, 36]} />
        <ReferenceLine x={1} stroke="var(--color-loss)" strokeDasharray="3 3" />
        <Tooltip
          cursor={{ stroke: "var(--color-line-strong)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as { maeR: number; mfeR: number; rMultiple: number | null };
            return (
              <TooltipBox
                rows={[
                  { label: "MAE", value: `${num(p.maeR, 2)}R` },
                  { label: "MFE", value: `${num(p.mfeR, 2)}R` },
                  {
                    label: "Wynik",
                    value: rValue(p.rMultiple),
                    tone: (p.rMultiple ?? 0) >= 0 ? "text-profit" : "text-loss",
                  },
                ]}
              />
            );
          }}
        />
        <Scatter data={wins} fill="var(--color-profit)" fillOpacity={0.75} isAnimationActive={false} />
        <Scatter data={losses} fill="var(--color-loss)" fillOpacity={0.75} isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/** Poziome slupki porownania grup - setupy, instrumenty, dni tygodnia. */
export function GroupBars({
  data,
  currency,
  unit,
  height,
}: {
  data: { label: string; value: number; count: number }[];
  currency: string;
  unit: "cash" | "r";
  height?: number;
}) {
  const computed = height ?? Math.max(140, data.length * 30 + 30);
  const format = (w: number) => (unit === "cash" ? moneyShort(w, currency) : `${num(w, 2)}R`);

  return (
    <ResponsiveContainer width="100%" height={computed}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={OS.stroke} horizontal={false} />
        <XAxis
          type="number"
          tick={OS.tick}
          axisLine={OS.axisLine}
          tickLine={OS.tickLine}
          tickFormatter={format}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={OS.tick}
          axisLine={OS.axisLine}
          tickLine={OS.tickLine}
          width={132}
        />
        <ReferenceLine x={0} stroke="var(--color-line-strong)" />
        <Tooltip
          cursor={{ fill: "var(--color-surface-2)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as { label: string; value: number; count: number };
            return (
              <TooltipBox
                title={p.label}
                rows={[
                  {
                    label: unit === "cash" ? "Wynik" : "Suma R",
                    value: format(p.value),
                    tone: p.value >= 0 ? "text-profit" : "text-loss",
                  },
                  { label: "Trade'y", value: String(p.count) },
                ]}
              />
            );
          }}
        />
        <Bar dataKey="value" isAnimationActive={false} radius={[0, 2, 2, 0]} barSize={16}>
          {data.map((d) => (
            <Cell key={d.label} fill={d.value >= 0 ? "var(--color-profit)" : "var(--color-loss)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
