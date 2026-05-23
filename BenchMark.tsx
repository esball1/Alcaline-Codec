'use client';

import { useState, useRef, useCallback } from 'react';
import {
  Upload, Trash2, RefreshCw, Trophy, Zap, Timer, HardDrive,
  ArrowDownUp, Image as ImageIcon, CheckCircle2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  encodeImage,
  decodeAlc,
  formatBytes,
  type AlcCompression,
  type AlcEncodeOptions,
  type AlcEncodeResult,
  COMP_ZLIB,
  COMP_DEFLATE_RAW,
  COMP_NONE,
} from '@/lib/alc';

interface BenchResult {
  tileSize: number;
  compression: AlcCompression;
  channels: 3 | 4;
  alcSize: number;
  encodeMs: number;
  decodeMs: number;
  ratio: number;
  vsPng: number;
  rawSize: number;
}

interface Summary {
  totalTests: number;
  bestRatio: BenchResult | null;
  fastestEncode: BenchResult | null;
  fastestDecode: BenchResult | null;
  smallestFile: BenchResult | null;
  pngSize: number;
}

function DropZone({ label, onFile, file, onClear }: {
  label: string;
  onFile: (f: File) => void;
  file: File | null;
  onClear: () => void;
}) {
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      className={cn(
        'relative border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer',
        drag ? 'border-teal-500 bg-teal-500/5' : 'border-muted-foreground/25 hover:border-teal-500/50',
        file && 'border-teal-500/50 bg-teal-500/5',
      )}
      onClick={() => ref.current?.click()}
    >
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      {file ? (
        <div className="flex items-center justify-center gap-3">
          <ImageIcon className="w-5 h-5 text-teal-500" />
          <span className="text-sm font-medium truncate max-w-[200px]">{file.name}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Upload className="w-8 h-8 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-xs text-muted-foreground/60">PNG, JPEG, or WebP</p>
        </div>
      )}
    </div>
  );
}

function compressionLabel(c: AlcCompression): string {
  switch (c) {
    case COMP_NONE: return 'None';
    case COMP_ZLIB: return 'Zlib';
    case COMP_DEFLATE_RAW: return 'Deflate';
    default: return '?';
  }
}

function loadImage(file: File): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d')!.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
}

function getPngSize(canvas: HTMLCanvasElement): Promise<number> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob.size);
        } else {
          reject(new Error('PNG blob failed'));
        }
      },
      'image/png',
    );
  });
}

export default function BenchmarkTab() {
  const [file, setFile] = useState<File | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [results, setResults] = useState<BenchResult[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);

  const handleFile = useCallback(async (f: File) => {
    try {
      const c = await loadImage(f);
      setFile(f);
      setCanvas(c);
      setResults([]);
      setSummary(null);
    } catch {
      alert('Could not load image.');
    }
  }, []);

  const handleClear = useCallback(() => {
    setFile(null);
    setCanvas(null);
    setResults([]);
    setSummary(null);
  }, []);

  const runBenchmark = useCallback(async () => {
    if (!canvas) return;
    setBusy(true);
    setProgress(0);
    setResults([]);

    try {
      const TILE_SIZES = [64, 128, 256, 512] as const;
      const COMPRESSIONS: AlcCompression[] = [COMP_ZLIB, COMP_DEFLATE_RAW, COMP_NONE];
      const CHANNELS: (3 | 4)[] = [3, 4];

      setProgressLabel('Measuring PNG baseline...');
      setProgress(1);
      const pngSize = await getPngSize(canvas);

      const allResults: BenchResult[] = [];
      const totalConfigs = TILE_SIZES.length * COMPRESSIONS.length * CHANNELS.length;
      let completed = 0;

      for (const ts of TILE_SIZES) {
        for (const comp of COMPRESSIONS) {
          for (const ch of CHANNELS) {
            setProgressLabel(`tile=${ts} ${compressionLabel(comp)} ch=${ch}`);
            const pctBase = (completed / totalConfigs) * 100;

            const opts: AlcEncodeOptions = {
              tileSize: ts,
              compression: comp,
              channels: ch,
              bitdepth: 8,
            };

            const encStart = performance.now();
            const encResult: AlcEncodeResult = await encodeImage(canvas, opts);
            const encMs = performance.now() - encStart;

            setProgress(Math.round(pctBase + (1 / totalConfigs) * 40));

            const buf = await encResult.blob.arrayBuffer();
            const alcSize = buf.byteLength;

            const decStart = performance.now();
            await decodeAlc(buf);
            const decMs = performance.now() - decStart;

            const rawSize = encResult.originalSize;
            const ratio = rawSize > 0 ? ((1 - alcSize / rawSize) * 100) : 0;
            const vsPng = pngSize > 0 ? ((alcSize / pngSize - 1) * 100) : 0;

            allResults.push({
              tileSize: ts,
              compression: comp,
              channels: ch,
              alcSize,
              encodeMs: encMs,
              decodeMs: decMs,
              ratio,
              vsPng,
              rawSize,
            });

            completed++;
            setProgress(Math.round(((completed + 0.5) / totalConfigs) * 100));
          }
        }
      }

      allResults.sort((a, b) => a.alcSize - b.alcSize);

      const bestRatio = allResults.reduce<BenchResult | null>(
        (best, r) => (!best || r.ratio > best.ratio ? r : best), null,
      );
      const fastestEncode = allResults.reduce<BenchResult | null>(
        (best, r) => (!best || r.encodeMs < best.encodeMs ? r : best), null,
      );
      const fastestDecode = allResults.reduce<BenchResult | null>(
        (best, r) => (!best || r.decodeMs < best.decodeMs ? r : best), null,
      );
      const smallestFile = allResults[0] ?? null;

      setSummary({
        totalTests: allResults.length,
        bestRatio,
        fastestEncode,
        fastestDecode,
        smallestFile,
        pngSize,
      });
      setResults(allResults);
      setProgress(100);
      setProgressLabel('Done');
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Benchmark error');
    } finally {
      setBusy(false);
    }
  }, [canvas]);

  const bestRatioIdx = summary?.bestRatio
    ? results.findIndex(
        (r) =>
          r.tileSize === summary.bestRatio!.tileSize &&
          r.compression === summary.bestRatio!.compression &&
          r.channels === summary.bestRatio!.channels,
      )
    : -1;

  const smallestIdx = 0;

  return (
    <div className="space-y-6">
      <DropZone
        label="Drop an image to benchmark all configurations"
        onFile={handleFile}
        file={file}
        onClear={handleClear}
      />

      {canvas && file && (
        <Card className="overflow-hidden">
          <div className="bg-muted/30 p-3 flex items-center justify-center max-h-48 overflow-hidden">
            <img
              src={canvas.toDataURL()}
              alt="Preview"
              className="max-w-full max-h-40 object-contain rounded"
            />
          </div>
          <CardContent className="p-3">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{canvas.width}&times;{canvas.height} &mdash; {file.name}</span>
              <span>{formatBytes(file.size)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {canvas && (
        <Card>
          <CardContent className="p-4">
            <Button
              onClick={runBenchmark}
              disabled={busy}
              className="w-full"
            >
              {busy
                ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Benchmarking...</>
                : <><Zap className="w-4 h-4 mr-2" />Run Benchmark (24 configs)</>}
            </Button>
            {busy && (
              <div className="mt-3 space-y-1">
                <Progress value={progress} className="h-1.5" />
                <p className="text-xs text-muted-foreground text-center">{progressLabel}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {summary && !busy && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-muted/30">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold">{summary.totalTests}</div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                <ArrowDownUp className="w-3 h-3" /> Tests Run
              </div>
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-teal-500">
                {summary.bestRatio ? `${summary.bestRatio.ratio.toFixed(1)}%` : '—'}
              </div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                <Trophy className="w-3 h-3" /> Best Ratio
              </div>
              {summary.bestRatio && (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  tile={summary.bestRatio.tileSize} {compressionLabel(summary.bestRatio.compression)} {summary.bestRatio.channels}ch
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-amber-500">
                {summary.fastestEncode ? `${summary.fastestEncode.encodeMs.toFixed(0)}ms` : '—'}
              </div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                <Zap className="w-3 h-3" /> Fastest Encode
              </div>
              {summary.fastestEncode && (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  tile={summary.fastestEncode.tileSize} {compressionLabel(summary.fastestEncode.compression)} {summary.fastestEncode.channels}ch
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-emerald-500">
                {summary.fastestDecode ? `${summary.fastestDecode.decodeMs.toFixed(0)}ms` : '—'}
              </div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                <Timer className="w-3 h-3" /> Fastest Decode
              </div>
              {summary.fastestDecode && (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  tile={summary.fastestDecode.tileSize} {compressionLabel(summary.fastestDecode.compression)} {summary.fastestDecode.channels}ch
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {summary && !busy && (
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">PNG Baseline</span>
            </div>
            <Badge variant="outline" className="font-mono text-xs">
              {formatBytes(summary.pngSize)}
            </Badge>
          </CardContent>
        </Card>
      )}

      {results.length > 0 && !busy && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <HardDrive className="w-4 h-4 text-teal-500" />
              Benchmark Results
            </CardTitle>
            <CardDescription>
              Sorted by file size (smallest first) &mdash; {results.length} configurations
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="px-4">#</TableHead>
                    <TableHead className="px-2">Config</TableHead>
                    <TableHead className="px-2 text-right">.alc Size</TableHead>
                    <TableHead className="px-2 text-right">vs PNG</TableHead>
                    <TableHead className="px-2 text-right">Ratio</TableHead>
                    <TableHead className="px-2 text-right">Encode</TableHead>
                    <TableHead className="px-2 text-right">Decode</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r, i) => {
                    const isBestRatio = i === bestRatioIdx;
                    const isSmallest = i === smallestIdx;

                    return (
                      <TableRow
                        key={`${r.tileSize}-${r.compression}-${r.channels}`}
                        className={cn(
                          isBestRatio && 'bg-teal-500/5',
                        )}
                      >
                        <TableCell className="px-4 text-muted-foreground font-mono text-xs">
                          {i + 1}
                          {isSmallest && (
                            <Trophy className="w-3 h-3 text-teal-500 inline ml-1" />
                          )}
                        </TableCell>
                        <TableCell className="px-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge variant="secondary" className="text-[10px] font-mono h-5 px-1.5">
                              {r.tileSize}
                            </Badge>
                            <Badge
                              variant={r.compression === COMP_NONE ? 'outline' : 'secondary'}
                              className={cn(
                                'text-[10px] font-mono h-5 px-1.5',
                                r.compression === COMP_NONE && 'text-muted-foreground',
                              )}
                            >
                              {compressionLabel(r.compression)}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] font-mono h-5 px-1.5">
                              {r.channels === 3 ? 'RGB' : 'RGBA'}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="px-2 text-right font-mono text-xs">
                          {formatBytes(r.alcSize)}
                        </TableCell>
                        <TableCell className={cn(
                          'px-2 text-right font-mono text-xs font-medium',
                          r.vsPng <= 0 ? 'text-teal-500' : 'text-red-500',
                        )}>
                          {r.vsPng <= 0 ? '' : '+'}{r.vsPng.toFixed(1)}%
                        </TableCell>
                        <TableCell className={cn(
                          'px-2 text-right font-mono text-xs font-medium',
                          isBestRatio ? 'text-teal-500' : '',
                        )}>
                          {r.ratio.toFixed(1)}%
                          {isBestRatio && <CheckCircle2 className="w-3 h-3 text-teal-500 inline ml-0.5" />}
                        </TableCell>
                        <TableCell className="px-2 text-right font-mono text-xs text-muted-foreground">
                          {r.encodeMs.toFixed(0)}ms
                        </TableCell>
                        <TableCell className="px-2 text-right font-mono text-xs text-muted-foreground">
                          {r.decodeMs.toFixed(0)}ms
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
          <CardContent className="p-4 pt-2">
            <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Trophy className="w-3 h-3 text-teal-500" /> Smallest file
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-teal-500" /> Best compression ratio
              </span>
              <span className="flex items-center gap-1">
                vs PNG: <span className="text-teal-500">green</span> = smaller, <span className="text-red-500">red</span> = larger
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {!canvas && results.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <Zap className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">Load an image to run the benchmark</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Tests 4&times;3&times;2 = 24 configurations against PNG baseline
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
