import { defineConfig } from 'vite';
export default defineConfig({root:'web',base:'./',build:{outDir:'dist',emptyOutDir:true,chunkSizeWarningLimit:1800},server:{host:'127.0.0.1'},preview:{host:'127.0.0.1'}});
