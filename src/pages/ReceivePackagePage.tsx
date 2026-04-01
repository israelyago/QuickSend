import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export function ReceivePackagePage() {
  return (
    <div className="flex items-center justify-center min-h-[500px] px-4">
      <Card className="w-full max-w-md shadow-2xl border-slate-200/50 dark:border-zinc-800/50 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm overflow-hidden">
        <div className="h-1.5 w-full bg-gradient-to-r from-primary/30 via-primary to-primary/30 animate-pulse" />
        <CardContent className="pt-12 pb-10 flex flex-col items-center text-center gap-8">
          <div className="relative">
            <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full scale-150 animate-pulse" />
            <div className="relative h-20 w-20 bg-gradient-to-br from-primary/10 to-primary/5 rounded-2xl flex items-center justify-center border border-primary/20 rotate-3 shadow-lg">
              <Loader2 className="h-10 w-10 text-primary animate-spin" strokeWidth={1.5} />
            </div>
          </div>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <h3 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-zinc-100">
                Architecting New Flow
              </h3>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary/60">
                In Development
              </p>
            </div>
            
            <p className="text-slate-500 dark:text-zinc-400 leading-relaxed max-w-[280px] mx-auto">
              We are separating the package viewing experience to provide a more tailored download journey. 
            </p>
          </div>

          <div className="w-full h-px bg-gradient-to-r from-transparent via-slate-200 dark:via-zinc-800 to-transparent" />
          
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Routing system active</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
