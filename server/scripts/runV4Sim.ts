/**
 * Standalone v4 simulation runner - runs without the web server
 * Usage: tsx server/scripts/runV4Sim.ts
 */

import { DatabaseStorage } from "../storage";
import { runHistoricalSimulation } from "../historicalSimulator";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { neonConfig } from "@neondatabase/serverless";

neonConfig.webSocketConstructor = ws;

async function main() {
  const storage = new DatabaseStorage();
  
  // Get user
  const user = await storage.getUserByUsername("Hbg");
  if (!user) { console.error("User not found"); process.exit(1); }
  
  const strategyVersion = user.currentStrategyVersion ?? "v4";
  console.log(`[Runner] User: ${user.username}, version: ${strategyVersion}`);
  
  // Get already-completed dates
  const alreadyDone = await storage.getCompletedDatesByVersion(user.id, strategyVersion);
  console.log(`[Runner] Already completed: ${alreadyDone.size} dates`);
  
  // Generate date list going back 365 days
  const dates: string[] = [];
  const today = new Date();
  let d = new Date(today);
  d.setDate(d.getDate() - 1); // Start from yesterday
  
  while (dates.length < 365) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) { // Skip weekends
      const dateStr = d.toISOString().slice(0, 10);
      if (!alreadyDone.has(dateStr)) {
        dates.push(dateStr);
      }
    }
    d.setDate(d.getDate() - 1);
  }
  
  console.log(`[Runner] Dates to process: ${dates.length} (starting from ${dates[0]} going back to ${dates[dates.length-1]})`);
  
  let totalTrades = 0;
  let processed = 0;
  
  for (const date of dates) {
    const run = await storage.createSimulationRun({
      userId: user.id,
      simulationDate: date,
      status: "pending",
      tickers: null,
      strategyVersion,
    });
    
    console.log(`[Runner] Processing ${date} (${processed + 1}/${dates.length}, ${totalTrades} trades so far)`);
    
    await runHistoricalSimulation(run.id, date, user.id, storage);
    
    const completedRun = await storage.getSimulationRun(run.id);
    const trades = completedRun?.tradesGenerated ?? 0;
    totalTrades += trades;
    processed++;
    
    if (trades > 0) {
      console.log(`[Runner] *** ${date}: ${trades} trades generated! Total: ${totalTrades}`);
    }
    
    if (totalTrades >= 120) {
      console.log(`[Runner] Target of 120 trades reached! Stopping.`);
      break;
    }
  }
  
  console.log(`[Runner] Done. Processed ${processed} dates, ${totalTrades} total trades.`);
  process.exit(0);
}

main().catch(err => {
  console.error("[Runner] Fatal:", err.message);
  process.exit(1);
});
