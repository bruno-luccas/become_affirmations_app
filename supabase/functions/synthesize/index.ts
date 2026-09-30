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

    // Decode base64 voice sample
    const voiceBytes = Uint8Array.from(atob(voice_sample_b64), (c) => c.charCodeAt(0));
    const voiceBlob = new Blob([voiceBytes], { type: "audio/webm" });

    // Step 1: Clone voice
    const cloneForm = new FormData();
    cloneForm.append("title", "Become User Voice");
    cloneForm.append("visibility", "private");
    cloneForm.append("type", "tts");
    cloneForm.append("train_mode", "fast");
    cloneForm.append("voices", voiceBlob, "voice.webm");

    const cloneRes = await fetch(`${FISH_BASE}/model`, {
      method: "POST",
      headers: { Authorization: `Bearer ${FISH_API_KEY}` },
      body: cloneForm,
    });

    if (!cloneRes.ok) {
      const err = await cloneRes.text();
      console.error("Fish Audio clone error:", cloneRes.status, err);
      return new Response(
        JSON.stringify({ error: "Voice clone failed", detail: err, status: cloneRes.status }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cloneData = await cloneRes.json();
    const referenceId = cloneData._id;
    console.log("Voice cloned successfully, reference_id:", referenceId);

    // Step 2: Synthesize all affirmations in parallel
    const audios = await Promise.all(
      affirmations.map(async (text: string) => {
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
            model: "s2.1-pro",
          }),
        });

        if (!ttsRes.ok) {
          const err = await ttsRes.text();
          console.error(`TTS failed for: "${text}" — ${err}`);
          return "";
        }

        const audioBuffer = await ttsRes.arrayBuffer();
        const bytes = new Uint8Array(audioBuffer);
        const chunkSize = 10000;
        let binary = "";
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
      })
    );

    console.log("Returning audios:", audios.length, "items, first item length:", audios[0]?.length ?? 0);

    // Step 3: Clean up cloned model
    await fetch(`${FISH_BASE}/model/${referenceId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${FISH_API_KEY}` },
    });

    return new Response(
      JSON.stringify({ audios, count: audios.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Internal error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});