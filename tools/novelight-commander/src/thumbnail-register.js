import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { createClient } from "@supabase/supabase-js";
import { validateThumbnailPack } from "./archive.js";
import { resolveAllowedPath } from "./security.js";

const ALLOWED_LAYERS = new Set(["background","base_book","cover","pattern","symbol","frame","effect","cover_mask"]);

function requireProductionConfig(config) {
  if (!config.allowProduction) throw new Error("Official thumbnail registration requires NOVELIGHT_COMMANDER_ALLOW_PRODUCTION=true.");
  const url = process.env.NOVELIGHT_COMMANDER_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NOVELIGHT_COMMANDER_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminUserId = process.env.NOVELIGHT_COMMANDER_ADMIN_USER_ID;
  if (!url || !key || !adminUserId) throw new Error("Supabase URL, service role key and NOVELIGHT_COMMANDER_ADMIN_USER_ID must be configured locally.");
  if (!/^[0-9a-f-]{36}$/i.test(adminUserId)) throw new Error("NOVELIGHT_COMMANDER_ADMIN_USER_ID is invalid.");
  return { url, key, adminUserId, bucket:process.env.NOVELIGHT_COMMANDER_THUMBNAIL_BUCKET || "novel-thumbnails" };
}

async function loadManifest(zip, manifestPath, config) {
  if (manifestPath) return JSON.parse(await fs.readFile(resolveAllowedPath(manifestPath,config),"utf8"));
  const entry = zip.file("manifest.json");
  if (!entry) throw new Error("manifest.json not found.");
  return JSON.parse(await entry.async("string"));
}

export async function registerOfficialThumbnailPack(zipPath, manifestPath, confirmation, config) {
  if (confirmation !== "REGISTER_OFFICIAL_THUMBNAIL_PACK") throw new Error("Explicit registration confirmation string is required.");
  const production = requireProductionConfig(config);
  const validation = await validateThumbnailPack(zipPath,manifestPath,config);
  if (!validation.ok) throw new Error("Thumbnail pack validation failed; registration was not started.");

  const absolute = resolveAllowedPath(zipPath,config);
  const zip = await JSZip.loadAsync(await fs.readFile(absolute));
  const manifest = await loadManifest(zip,manifestPath,config);
  const items = Array.isArray(manifest.items) ? manifest.items : [];
  const packKey = String(manifest.packKey || path.basename(absolute));
  const supabase = createClient(production.url,production.key,{ auth:{ autoRefreshToken:false,persistSession:false } });
  const results = [];

  for (const item of items) {
    const layerType = String(item.layerType || item.sourceCategory || "").trim();
    const templateKey = String(item.templateKey || manifest.templateKey || "book-v1").trim();
    const label = String(item.label || item.displayName || item.key || "").trim();
    const sourceFileName = path.basename(String(item.path || ""));
    if (!ALLOWED_LAYERS.has(layerType)) throw new Error("Unsupported layer type: " + layerType);
    if (!label || !sourceFileName) throw new Error("Manifest item is missing label/path.");

    const { data:existingBySource, error:sourceError } = await supabase
      .from("novel_thumbnail_assets")
      .select("id,label,storage_path,source_sha256")
      .eq("layer_type",layerType)
      .eq("template_key",templateKey)
      .eq("source_sha256",String(item.sha256 || "").toLowerCase())
      .limit(2);
    if (sourceError) throw new Error("Existing asset lookup failed: " + sourceError.message);
    if ((existingBySource || []).length > 0) {
      results.push({ key:item.key,label,status:"skipped_existing_sha",id:existingBySource[0].id });
      continue;
    }

    const { data:existingLabel, error:labelError } = await supabase
      .from("novel_thumbnail_assets")
      .select("id,label,storage_path,source_sha256")
      .eq("layer_type",layerType)
      .eq("template_key",templateKey)
      .eq("label",label)
      .limit(2);
    if (labelError) throw new Error("Label collision lookup failed: " + labelError.message);
    if ((existingLabel || []).length > 0) throw new Error("Existing asset has the same label but a different source: " + label);

    const entry = zip.file(String(item.path));
    if (!entry) throw new Error("Validated ZIP entry disappeared: " + item.path);
    const bytes = await entry.async("nodebuffer");
    const storagePath = "official/" + crypto.randomUUID() + ".png";
    const { error:uploadError } = await supabase.storage.from(production.bucket).upload(storagePath,bytes,{ contentType:"image/png",upsert:false,cacheControl:"31536000" });
    if (uploadError) throw new Error("Storage upload failed for " + label + ": " + uploadError.message);

    const imageUrl = supabase.storage.from(production.bucket).getPublicUrl(storagePath).data.publicUrl;
    const { data:registered, error:registerError } = await supabase.rpc("novelight_admin_register_thumbnail_layer_asset",{
      p_admin_user_id:production.adminUserId,
      p_label:label,
      p_storage_path:storagePath,
      p_image_url:imageUrl,
      p_layer_type:layerType,
      p_template_key:templateKey,
      p_sort_order:Number(item.sortOrder ?? 1000),
      p_status:"active"
    });
    if (registerError) {
      await supabase.storage.from(production.bucket).remove([storagePath]);
      throw new Error("DB registration failed for " + label + ": " + registerError.message);
    }
    const row = Array.isArray(registered) ? registered[0] : registered;
    if (!row?.id) {
      await supabase.storage.from(production.bucket).remove([storagePath]);
      throw new Error("DB registration returned no asset id for " + label);
    }
    const { error:metadataError } = await supabase.from("novel_thumbnail_assets").update({
      display_name_ja:label,
      source_pack_key:packKey,
      source_file_name:sourceFileName,
      source_sha256:String(item.sha256 || "").toLowerCase()
    }).eq("id",row.id);
    if (metadataError) throw new Error("Metadata update failed for " + label + ": " + metadataError.message);
    results.push({ key:item.key,label,status:"registered",id:row.id,storagePath });
  }

  return { packKey, total:items.length, registered:results.filter(r => r.status === "registered").length, skipped:results.filter(r => r.status !== "registered").length, results };
}
