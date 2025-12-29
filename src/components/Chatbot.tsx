'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Send, Bot, User, Play, Volume2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface Model {
  name: string
  size: number
  digest: string
  details?: unknown
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface Voice {
  name: string
  path: string
  extension: string
}

export default function Chatbot() {
  const [models, setModels] = useState<Model[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [voices, setVoices] = useState<Voice[]>([])
  const [selectedVoice, setSelectedVoice] = useState<string>('')
  const [playingAudio, setPlayingAudio] = useState<string | null>(null)
  const [generatingAudio, setGeneratingAudio] = useState<string | null>(null)
  const [autoPlay, setAutoPlay] = useState(false)
  const [responseLength, setResponseLength] = useState<number[]>([5])
  const audioRefs = useRef<{ [key: string]: HTMLAudioElement }>({})

  // Cleanup audio references on unmount
  useEffect(() => {
    return () => {
      Object.values(audioRefs.current).forEach(audio => {
        audio.pause()
        URL.revokeObjectURL(audio.src)
      })
    }
  }, [])

  useEffect(() => {
    fetchModels()
    fetchVoices()
  }, [])

  const fetchModels = async () => {
    try {
      const response = await fetch('http://localhost:11434/api/tags')
      const data = await response.json()
      setModels(data.models || [])
    } catch (error) {
      console.error('Failed to fetch models:', error)
    }
  }

  const fetchVoices = async () => {
    try {
      const response = await fetch('/api/voices')
      const data = await response.json()
      setVoices(data.voices || [])
    } catch (error) {
      console.error('Failed to fetch voices:', error)
    }
  }

  const generateTTS = async (text: string, messageId: string) => {
    if (!text.trim()) return

    setGeneratingAudio(messageId)

    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text,
          voice: selectedVoice || undefined
        })
      })

      const data = await response.json()

      if (data.success && data.audio) {
        // Convert base64 to blob and create audio URL
        const audioData = atob(data.audio)
        const arrayBuffer = new ArrayBuffer(audioData.length)
        const uint8Array = new Uint8Array(arrayBuffer)
        for (let i = 0; i < audioData.length; i++) {
          uint8Array[i] = audioData.charCodeAt(i)
        }
        const blob = new Blob([uint8Array], { type: 'audio/wav' })
        const audioUrl = URL.createObjectURL(blob)

        // Create audio element
        const audio = new Audio(audioUrl)
        audioRefs.current[messageId] = audio

        // Handle audio events
        audio.onended = () => {
          setPlayingAudio(null)
        }

        audio.onerror = (error) => {
          console.error('Audio playback error:', error)
          setPlayingAudio(null)
        }

        // Stop any currently playing audio
        if (playingAudio && playingAudio !== messageId) {
          stopTTS(playingAudio)
        }

        setPlayingAudio(messageId)
        
        // Play the audio with error handling for browser autoplay policies
        try {
          const playPromise = audio.play()
          if (playPromise !== undefined) {
            await playPromise
          }
        } catch (playError) {
          console.error('Failed to play audio:', playError)
          setPlayingAudio(null)
          // Try to resume audio context for autoplay policies
          try {
            const context = new (window.AudioContext || (window as any).webkitAudioContext)()
            if (context.state === 'suspended') {
              await context.resume()
              // Retry play after context resume
              await audio.play()
            }
          } catch (resumeError) {
            console.error('Failed to resume audio context:', resumeError)
          }
        }
      } else {
        console.error('TTS generation failed:', data.error)
        // Show user-friendly error message
        alert('Text-to-speech failed: ' + (data.error || 'Unknown error'))
      }
    } catch (error) {
      console.error('Failed to generate TTS:', error)
    } finally {
      setGeneratingAudio(null)
    }
  }

  const stopTTS = (messageId: string) => {
    const audio = audioRefs.current[messageId]
    if (audio) {
      audio.pause()
      audio.currentTime = 0
      setPlayingAudio(null)
    }
  }

  const sendMessage = async () => {
    if (!input.trim() || !selectedModel) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)

    // Create response length instruction based on slider value
    const lengthValue = responseLength[0]
    let lengthInstruction = ''
    if (lengthValue <= 3) {
      lengthInstruction = 'Please provide a short, concise response (1-2 sentences). '
    } else if (lengthValue <= 7) {
      lengthInstruction = 'Please provide a medium-length response (3-5 sentences). '
    } else {
      lengthInstruction = 'Please provide a detailed, comprehensive response (6+ sentences). '
    }

    const enhancedPrompt = lengthInstruction + input

    try {
      const response = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: selectedModel,
          prompt: enhancedPrompt,
          stream: false
        })
      })

      const data = await response.json()

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response
      }

      setMessages(prev => [...prev, assistantMessage])

      // Auto-play TTS if enabled
      if (autoPlay) {
        setTimeout(() => {
          generateTTS(data.response, assistantMessage.id)
        }, 100) // Small delay to ensure message is rendered
      }
    } catch (error) {
      console.error('Failed to send message:', error)
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Error: Failed to get response from Ollama. Make sure Ollama is running.'
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-6 w-6" />
              Ollama Chatbot
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Select Model</label>
                <Select value={selectedModel} onValueChange={setSelectedModel}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a model..." />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((model) => (
                      <SelectItem key={model.name} value={model.name}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Select Voice (for TTS)</label>
                <Select value={selectedVoice} onValueChange={setSelectedVoice}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a voice..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default Voice</SelectItem>
                    {voices.map((voice) => (
                      <SelectItem key={voice.path} value={voice.path}>
                        {voice.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Response Length: {responseLength[0]} {responseLength[0] <= 3 ? '(Short)' : responseLength[0] <= 7 ? '(Medium)' : '(Long)'}</label>
                <Slider
                  value={responseLength}
                  onValueChange={setResponseLength}
                  max={10}
                  min={1}
                  step={1}
                  className="mt-2"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>Short</span>
                  <span>Long</span>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button onClick={fetchModels} variant="outline" className="active:scale-95 transition-transform">
                  Refresh Models
                </Button>
                <Button onClick={fetchVoices} variant="outline" className="active:scale-95 transition-transform">
                  Refresh Voices
                </Button>
                <Button
                  onClick={() => setAutoPlay(!autoPlay)}
                  variant={autoPlay ? "default" : "outline"}
                  className="active:scale-95 transition-transform"
                >
                  <Play className="h-4 w-4 mr-1" />
                  {autoPlay ? 'Auto Play ON' : 'Auto Play OFF'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="h-[600px] flex flex-col">
          <CardHeader>
            <CardTitle>Chat</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col">
            <div className="flex-1 overflow-y-auto space-y-4 mb-4">
              <AnimatePresence>
                {messages.map((message) => (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className={`flex items-start gap-3 ${
                      message.role === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    {message.role === 'assistant' && (
                      <Bot className="h-6 w-6 mt-1 text-blue-500" />
                    )}
                    <div className="flex flex-col gap-2">
                      <div
                        className={`max-w-[70%] p-3 rounded-lg ${
                          message.role === 'user'
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-100 text-gray-900'
                        }`}
                      >
                        {message.content}
                      </div>
                      {message.role === 'assistant' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (playingAudio === message.id) {
                              stopTTS(message.id)
                            } else {
                              generateTTS(message.content, message.id)
                            }
                          }}
                          disabled={!message.content.trim() || generatingAudio === message.id}
                          className="self-start active:scale-95 transition-transform"
                        >
                          {generatingAudio === message.id ? (
                            <>
                              <Bot className="h-4 w-4 mr-1 animate-spin" />
                              Generating...
                            </>
                          ) : playingAudio === message.id ? (
                            <>
                              <Volume2 className="h-4 w-4 mr-1" />
                              Stop
                            </>
                          ) : (
                            <>
                              <Play className="h-4 w-4 mr-1" />
                              Play
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                    {message.role === 'user' && (
                      <User className="h-6 w-6 mt-1 text-gray-500" />
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              {loading && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-2 text-gray-500"
                >
                  <Bot className="h-4 w-4 animate-spin" />
                  Thinking...
                </motion.div>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Type your message..."
                disabled={loading}
              />
              <Button onClick={sendMessage} disabled={loading || !selectedModel} className="active:scale-95 transition-transform">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}