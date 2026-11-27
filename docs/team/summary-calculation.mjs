import {warehouses,today,ordered,latest,matchingRoutes,baseCost,costForRoute} from './model.mjs';
import {quoteAtCbr} from './cbr.mjs';
export function summaryCalculation(s,state,fx,{warehouse='',asOf=today()}={}){
 const history=ordered(state.quotes.filter(q=>q.supplier_id===s.id&&q.quote_date<=asOf)),q=history[0]||null,calculationQuote=quoteAtCbr(q,fx),base=baseCost(calculationQuote);
 const options=matchingRoutes(calculationQuote,state.routes,warehouse).map(route=>{const rate=latest(state.rates.filter(r=>r.quote_date<=asOf),'route_id',route.id);return {route,rate,cost:costForRoute(calculationQuote,route,rate)};});
 const destinations=(warehouse?[warehouse]:warehouses).map(warehouse=>({warehouse,options:options.filter(o=>o.route.warehouse===warehouse)}));
 return {s,q,previous:history[1],calculationQuote,base,options,destinations,warehouse};
}
