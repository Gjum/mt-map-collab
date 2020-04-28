<script>
  import DraggableList from "./DraggableList.svelte";
  import MapUploader from "./MapUploader.svelte";
  import MapUpload from "./MapUpload.svelte";

  export let api;

  let uploads = [];

  function onFilesAdded(newFiles) {
    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      uploads.push({
        file,
        uploadPromise: api.uploadSqlite(file),
        id: newUploadId()
      });
    }
    uploads = uploads;
    mergePromise = null;
  }

  function removeIndex(index) {
    uploads.splice(index, 1);
    uploads = uploads;
    mergePromise = null;
  }

  let uploadId = 1;
  const newUploadId = () => ++uploadId;

  let mergePromise = null;
  function doMerge() {
    mergePromise = (async () => {
      const hashes = await Promise.all(
        uploads.map(async u => (await u.uploadPromise).hash)
      );
      await fetch(api.mergeRenderUrl(hashes));
      return {
        mapUrl: api.mergeMapUrl(hashes),
        renderUrl: api.mergeRenderUrl(hashes)
      };
    })();
  }
</script>

<style>
  main {
    padding: 1em;
    max-width: 800px;
    margin: 0 auto;
  }
  h1 {
    text-align: center;
    color: #1f8000;
    font-size: 4em;
    font-weight: 100;
  }
  .centeredList {
    margin: 1em auto;
    max-width: 30em;
    text-align: left;
  }
  .button-big {
    padding: 2em;
    margin-top: 1em;
    background-color: #1f8000;
    color: white;
    border-radius: 1.5em;
  }
  img {
    max-width: 100%;
    max-height: 100%;
  }
  .uploader,
  .mergeResult {
    text-align: center;
    align-content: center;
  }
  .footer {
    text-align: center;
    margin-top: 5em;
  }
</style>

<main>
  <h1>MT Map Collab</h1>
  <DraggableList
    bind:list={uploads}
    key={it => it.id}
    let:item
    let:index
    on:reordered={() => (mergePromise = null)}>
    <MapUpload file={item.file} {api} onRemove={() => removeIndex(index)} />
  </DraggableList>

  <div class="uploader">
    {#if uploads.length > 0}
      <p>Click map to enlarge</p>
      <p>Right-click &#10159; Save image</p>
    {/if}
    <MapUploader {onFilesAdded} />
  </div>

  <div class="mergeResult">
    {#if !mergePromise}
      {#if uploads.length < 1}
        <h3>How to get a map download</h3>
        <ol class="centeredList">
          <li>In the Minetest Main menu, open the <em>"Settings"</em> tab</li>
          <li>Open <em>"All Settings"</em> and search for <em>"received"</em></li>
          <li>Enable <em>"Saving map received from server"</em></li>
          <li>Play the game for a while</li>
          <li>The world is saved in <em>minetest/worlds/(server address)/map.sqlite</em></li>
        </ol>
        <p>
          You can now upload the world here to render a map of it,
          <br />
          or share the file with someone else.
        </p>
      {/if}
      {#if uploads.length == 1}
        <p>
          Upload at least <strong>two</strong> worlds to merge them.
        </p>
      {/if}
      {#if uploads.length >= 2}
        <p>
          <strong>Drag</strong> uploads to reorder them
          and change what overrides what.
        </p>
        <button class="button-big" on:click={doMerge}>
          Merge all uploads top-to-bottom
        </button>
      {/if}
    {:else}
      {#await mergePromise}
        <p style="padding:3em;">
          Merging, please wait...
        </p>
      {:then result}
        <a href={result.renderUrl} target="_blank">
          <img
            class="mergeRender"
            alt="Merged map render"
            src={result.renderUrl} />
        </a>
        <p>Click map to enlarge</p>
        <p>Right-click &#10159; Save image</p>
        <p>Reorder uploads to change what overrides what</p>
        <a href={result.mapUrl} target="_blank">
          <button class="button-big">Download the merged world</button>
        </a>
      {:catch error}
        Merge error:
        <code>{error}</code>
      {/await}
    {/if}
  </div>

  <div class="footer">
    This service is brought to you by
    <a href="https://github.com/Gjum" target="_blank" rel="noopener noreferrer">
      Gjum</a>.
    Find the full project code on
    <a
      href="https://github.com/Gjum/mt-map-collab"
      target="_blank"
      rel="noopener noreferrer">
      Github</a>.
  </div>
</main>
