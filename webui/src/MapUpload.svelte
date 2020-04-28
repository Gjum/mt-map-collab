<script>
  export let file, api, onRemove;

  let uploadProgress = 0;
  let render = null;
</script>

<style>
  .outer {
    /* background-color: rgba(127, 127, 127, 0.1); */
    padding: 0.5em;
    margin: 4px;
    border-radius: 1.5em;
    display: flex;
    background-color: white;
    line-height: 2em;
  }
  .outer > * {
    margin-left: 0.5em;
  }
  .info {
    flex: 1;
    display: flex;
    align-items: center;
  }
  .result {
    height: 100px;
    width: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .result img {
    max-height: 100px;
    max-width: 200px;
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>

<div class="outer">
  <div class="info">
    {file.name}
    <br />
    {new Date(file.lastModified).toLocaleString()}
  </div>
  <div class="result">
    {#await api.uploadSqlite(file)}
      Uploading...
    {:then answer}
      <a href={api.mapRenderUrl(answer.hash)} target="_blank">
        <img alt="Map render" src={api.mapRenderUrl(answer.hash)} />
      </a>
    {:catch error}
      Upload error:
      <code>{error}</code>
    {/await}
  </div>
  <div class="actions">
    <button on:click={onRemove}>Remove</button>
  </div>
</div>
