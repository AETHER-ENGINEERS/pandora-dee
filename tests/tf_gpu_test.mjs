// The TensorFlow.js suite again, with a (software) GPU, so the WebGL backend path is covered too.
process.env.JV_GPU = '1';
await import('./tf_test.mjs');
