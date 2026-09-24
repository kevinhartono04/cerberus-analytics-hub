import { z } from "zod";
import { reviewRequestSchema } from "./review-request";
const text = (text: string) => ({type:"plain_text", text});
export function reviewForm(id: string, demo: boolean) {
 const input = (id: string, label: string, type = "plain_text_input") => ({type:"input", block_id:id, optional:true, label:text(label), element:{type,action_id:"value"}});
 return {type:"modal", callback_id:"refund_details", private_metadata:id, title:text(demo ? "DEMO — Refund review" : "Refund review"), submit:text("Check purchase"), close:text("Cancel"), blocks:[
  {type:"input",block_id:"dispute",label:text("Dispute type"),element:{type:"static_select",action_id:"value",options:[{text:text("Items / coins not received"),value:"items"},{text:text("No ads not working"),value:"no_ads"}]}},
  input("purchaseDate","Purchase date (UTC)","datepicker"), input("amountUsd","Purchase amount (USD)"), input("asOf","Ticket date (UTC; defaults to today)","datepicker")
 ]};
}
export const submissionSchema = z.object({type:z.literal("view_submission"),team:z.object({id:z.string()}),user:z.object({id:z.string()}),view:z.object({id:z.string(),callback_id:z.literal("refund_details"),private_metadata:z.string().max(300),state:z.object({values:z.record(z.string(),z.record(z.string(),z.object({value:z.string().nullable().optional(),selected_date:z.string().nullable().optional(),selected_option:z.object({value:z.string()}).nullable().optional()})))})})});
export function formInput(value: z.infer<typeof submissionSchema>) {
 const fields=value.view.state.values;
 const input={dispute:fields.dispute?.value?.selected_option?.value,purchaseDate:fields.purchaseDate?.value?.selected_date ?? "",amountUsd:fields.amountUsd?.value?.value ?? ""};
 const parsed=reviewRequestSchema.safeParse(input);
 const asOf=fields.asOf?.value?.selected_date ?? "";
 const errors:Record<string,string>={};
 if(!parsed.success) for(const issue of parsed.error.issues) errors[String(issue.path[0])]=issue.message;
 if(asOf && (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0,10)!==asOf || asOf>new Date().toISOString().slice(0,10))) errors.asOf="Use a valid date on or before today (UTC).";
 if(input.purchaseDate && asOf && input.purchaseDate>asOf) errors.purchaseDate="Purchase date must be on or before the ticket date.";
 const through=asOf ? Date.parse(`${asOf}T23:59:59.999Z`) : Date.now();
 if(input.purchaseDate && input.purchaseDate < new Date(through-90*86400000).toISOString().slice(0,10)) errors.purchaseDate="Outside the 90-day window. Choose an earlier ticket date.";
 return {errors,review:parsed.success ? parsed.data : undefined,asOf};
}
