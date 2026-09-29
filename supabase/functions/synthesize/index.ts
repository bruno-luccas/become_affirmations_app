const FISH_API_KEY = Deno.env.get("FISH_API_KEY") ?? "";
const FISH_BASE = "https://api.fish.audio";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { voice_sample_b64, affirmations } = await req.json();

    if (!voice_sample_b64 || !affirmations || affirmations.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing voice_sample_b64 or affirmations" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const voiceBytes = Uint8Array.from(atob(voice_sample_b64), (c) => c.charCodeAt(0));
    const voiceBlob = new Blob([voiceBytes], { type: "audio/webm" });

    const cloneForm = new FormData();
    cloneForm.append("title", "Become User Voice");
    cloneForm.append("visibility", "private");
    cloneForm.append("voices", voiceBlob, "voice.webm");

    const cloneRes = await fetch(`${FISH_BASE}/model`, {
      method: "POST",
      headers: { Authorization: `Bearer ${FISH_API_KEY}` },
      body: cloneForm,
    });

    if (!cloneRes.ok) {
      const err = await cloneRes.text();
      return new Response(
        JSON.stringify({ error: "Voice clone failed", detail: err }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cloneData = await cloneRes.json();
    const referenceId = cloneData._id;

    const audioResults = [];

    for (const text of affirmations) {
      const ttsRes = await fetch(`${FISH_BASE}/v1/tts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${FISH_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          reference_id: referenceId,
          format: "wav",
          latency: "normal",
        }),
      });

      if (!ttsRes.ok) {
        audioResults.push("");
        continue;
      }

      const audioBuffer = await ttsRes.arrayBuffer();
      const audioB64 = btoa(String.fromCharCode(...new Uint8Array(audioBuffer)));
      audioResults.push(audioB64);
    }

    await fetch(`${FISH_BASE}/model/${referenceId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${FISH_API_KEY}` },
    });

    return new Response(
      JSON.stringify({ audios: audioResults, count: audioResults.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal error", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
