import { runAgent } from "./agent/agent";

async function test() {
  const tests = [
    {
      name: "Motorbike question (EN)",
      input: "Do you rent motorbikes?",
    },
    {
      name: "Location question (EN)",
      input: "Where are you located?",
    },
    {
      name: "Vietnamese motorbike question",
      input: "Bạn có cho thuê xe máy không?",
      
    },
    {
  name: "Cat Ba test",
  input: "How do I get to Cat Ba?",
},
{
  name: "Loop test",
  input: "Tell me about the Ha Giang Loop",
},
{
  name: "General travel",
  input: "What should I do in northern Vietnam?",
},
    {
  name: "Bicycle rejection test",
  input: "Do you rent bicycles?",
}
  ];

  for (const t of tests) {
    console.log("\n====================");
    console.log("TEST:", t.name);
    console.log("INPUT:", t.input);

    const result = await runAgent(t.input);

    console.log("OUTPUT:", result);
  }
}

test();