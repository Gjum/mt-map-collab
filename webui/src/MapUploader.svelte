<script>
  export let onFilesAdded;
</script>

<style>
  /* TODO nice looking file selector */
</style>

<input
  type="file"
  multiple
  on:change={onFilesAdded(this.files)}
  accept="application/x-sqlite3,.sqlite"
  name="map" />
