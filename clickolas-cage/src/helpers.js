import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY, // defaults to process.env[""]
  dangerouslyAllowBrowser: true,
})

export const sendPromptToPlanner = async (prompt) => {
  console.log(prompt)
  console.log('thinking...')
  return;
  const chatCompletion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      {
        role: 'system',
        content: `you are an expert web browsing AI with the following functions available:
        1. Navigate to a URL (Codename: NAVURL({url}))
        2. Click a button (Codename: CLICKBTN({buttonId}))
        3. Input text (Codename: INPUT({fieldId},{textToInput}))
        4. Select an option in a form (Codename: SELECT({fieldId},{option}))
        5. Wait for page load and inspect contents of page (Codename: WAITLOAD())
        6. Ask the user for more information (Codename: ASKUSER({question})
        given a prompt from the user provide a step by step plan to execute it in a web browser only utilizing the 6 functions above using the relative codenames.
        if you are unsure of URL, Ask the user. if you are unsure of IDs wait for page load.`,
      },
      {
        role: 'user',
        content: `your first task is: ${prompt}`,
      },
      // {
      //   role: 'user',
      //   content: `I want to provide step by step single commands to be inputted into a chrome console to achieve the following task : ${prompt}.
      //   First only provide the command to which URL to navigate to. then I will provide the DOM elements you can interact with, afterwards provide a command to interact with the dom and we will continue this process until the task is achieved`,
      // },
    ],
  })
  console.log(chatCompletion.choices[0].message.content)
  return chatCompletion.choices[0].message.content
  // return chatCompletion.choices[0].text.strip()
}
