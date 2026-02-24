/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
import { 
  Search, 
  Upload, 
  FileText, 
  Download, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Loader2, 
  Plus, 
  Trash2,
  Globe,
  BarChart3,
  ChevronRight,
  Info
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import { GoogleGenAI } from "@google/genai";
import Markdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---

interface AnalysisResult {
  url: string;
  score: number;
  criteria: {
    hyperLocal: { status: 'pass' | 'fail' | 'partial'; feedback: string };
    naturalLanguage: { status: 'pass' | 'fail' | 'partial'; feedback: string };
    conciseAnswers: { status: 'pass' | 'fail' | 'partial'; feedback: string };
    internalLinks: { status: 'pass' | 'fail' | 'partial'; feedback: string };
    uniqueContent: { status: 'pass' | 'fail' | 'partial'; feedback: string };
  };
  summary: string;
  faqFound: boolean;
}

// --- Components ---

const StatusBadge = ({ status }: { status: 'pass' | 'fail' | 'partial' }) => {
  switch (status) {
    case 'pass':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 uppercase tracking-wider">
          <CheckCircle2 className="w-3 h-3" /> Pass
        </span>
      );
    case 'fail':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-100 text-rose-700 uppercase tracking-wider">
          <XCircle className="w-3 h-3" /> Fail
        </span>
      );
    case 'partial':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 uppercase tracking-wider">
          <AlertCircle className="w-3 h-3" /> Partial
        </span>
      );
  }
};

export default function App() {
  const [urls, setUrls] = useState<string[]>(['']);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleAddUrl = () => setUrls([...urls, '']);
  const handleRemoveUrl = (index: number) => {
    const newUrls = [...urls];
    newUrls.splice(index, 1);
    setUrls(newUrls.length ? newUrls : ['']);
  };
  const handleUrlChange = (index: number, value: string) => {
    const newUrls = [...urls];
    newUrls[index] = value;
    setUrls(newUrls);
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
      
      const extractedUrls = json
        .flat()
        .filter(cell => typeof cell === 'string' && cell.startsWith('http'))
        .map(url => url.trim());

      if (extractedUrls.length > 0) {
        setUrls(prev => {
          const filteredPrev = prev.filter(u => u.trim() !== '');
          return [...filteredPrev, ...extractedUrls];
        });
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls']
    },
    multiple: false
  });

  const runAnalysis = async () => {
    const validUrls = urls.filter(u => u.trim() !== '');
    if (validUrls.length === 0) {
      setError('Please enter at least one valid URL.');
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setResults([]);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      // We process URLs one by one or in small batches for better feedback
      // Using urlContext tool as per guidelines
      const newResults: AnalysisResult[] = [];

      for (const url of validUrls) {
        const prompt = `
          Analyze the FAQ section of this URL: ${url}
          
          Check these 5 criteria specifically:
          1. Hyper-Local Keywords: Do the questions include the city, neighborhood, or county name naturally?
          2. Natural Language: Are the questions phrased the way a human would speak (conversational)?
          3. Concise Answers: Is the answer between 40–60 words?
          4. Internal Links: Does the answer link to a relevant service page?
          5. Unique Content: Are the FAQs unique to that specific location?

          Return the analysis in this EXACT JSON format:
          {
            "url": "${url}",
            "score": number (0-100),
            "faqFound": boolean,
            "criteria": {
              "hyperLocal": { "status": "pass" | "fail" | "partial", "feedback": "string" },
              "naturalLanguage": { "status": "pass" | "fail" | "partial", "feedback": "string" },
              "conciseAnswers": { "status": "pass" | "fail" | "partial", "feedback": "string" },
              "internalLinks": { "status": "pass" | "fail" | "partial", "feedback": "string" },
              "uniqueContent": { "status": "pass" | "fail" | "partial", "feedback": "string" }
            },
            "summary": "string (markdown)"
          }
        `;

        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            tools: [{ urlContext: {} }],
            responseMimeType: "application/json"
          }
        });

        try {
          const result = JSON.parse(response.text || '{}');
          newResults.push(result);
        } catch (e) {
          console.error("Failed to parse result for", url, e);
          // Fallback for failed parse
        }
      }

      setResults(newResults);
    } catch (err: any) {
      setError(err.message || 'An error occurred during analysis.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const exportToExcel = () => {
    const data = results.map(r => ({
      URL: r.url,
      Score: r.score,
      'FAQ Found': r.faqFound ? 'Yes' : 'No',
      'Hyper-Local': r.criteria.hyperLocal.status,
      'Natural Language': r.criteria.naturalLanguage.status,
      'Concise Answers': r.criteria.conciseAnswers.status,
      'Internal Links': r.criteria.internalLinks.status,
      'Unique Content': r.criteria.uniqueContent.status,
      Summary: r.summary
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Analysis Results");
    XLSX.writeFile(workbook, "VW_SEO_Analysis.xlsx");
  };

  return (
    <div className="min-h-screen bg-[#F5F5F4] text-[#141414] font-sans selection:bg-[#141414] selection:text-white">
      {/* Header */}
      <header className="border-b border-[#141414]/10 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#141414] rounded-lg flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <h1 className="font-bold text-lg tracking-tight uppercase">VW PKW SEO/GEO Control</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-[10px] font-bold uppercase tracking-widest opacity-40">
              Internal Tool v1.0
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          
          {/* Left Column: Input */}
          <div className="lg:col-span-5 space-y-8">
            <section>
              <h2 className="text-3xl font-bold tracking-tight mb-4">Analyze Content</h2>
              <p className="text-[#141414]/60 leading-relaxed">
                With this tool, we can analyze the following points: Missing FAQ sections on relevant pages, 
                hyper-local keyword integration, and conversational phrasing.
              </p>
            </section>

            <div className="space-y-6">
              {/* URL Input List */}
              <div className="space-y-3">
                <label className="text-[11px] font-bold uppercase tracking-wider opacity-50 flex items-center gap-2">
                  <Globe className="w-3 h-3" /> Target URLs
                </label>
                <div className="space-y-2">
                  {urls.map((url, index) => (
                    <div key={index} className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          type="url"
                          value={url}
                          onChange={(e) => handleUrlChange(index, e.target.value)}
                          placeholder="https://www.volkswagen.de/..."
                          className="w-full bg-white border border-[#141414]/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/5 focus:border-[#141414] transition-all"
                        />
                      </div>
                      <button
                        onClick={() => handleRemoveUrl(index)}
                        className="p-3 text-rose-500 hover:bg-rose-50 rounded-xl transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleAddUrl}
                  className="w-full py-3 border-2 border-dashed border-[#141414]/10 rounded-xl text-sm font-medium flex items-center justify-center gap-2 hover:bg-white transition-all group"
                >
                  <Plus className="w-4 h-4 group-hover:scale-110 transition-transform" /> Add another URL
                </button>
              </div>

              {/* File Upload */}
              <div className="space-y-3">
                <label className="text-[11px] font-bold uppercase tracking-wider opacity-50 flex items-center gap-2">
                  <Upload className="w-3 h-3" /> Batch Import
                </label>
                <div 
                  {...getRootProps()} 
                  className={cn(
                    "border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer",
                    isDragActive ? "border-[#141414] bg-[#141414]/5" : "border-[#141414]/10 hover:border-[#141414]/30"
                  )}
                >
                  <input {...getInputProps()} />
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-12 h-12 bg-white rounded-full shadow-sm flex items-center justify-center border border-[#141414]/5">
                      <FileText className="w-6 h-6 text-[#141414]/40" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">Upload Excel file</p>
                      <p className="text-xs text-[#141414]/40 mt-1">Drag and drop or click to browse</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <button
                onClick={runAnalysis}
                disabled={isAnalyzing}
                className="w-full py-4 bg-[#141414] text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:opacity-90 disabled:opacity-50 transition-all shadow-lg shadow-[#141414]/10"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Analyzing Content...
                  </>
                ) : (
                  <>
                    <Search className="w-5 h-5" />
                    Run SEO/GEO Audit
                  </>
                )}
              </button>

              {error && (
                <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-sm flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  {error}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-7">
            <div className="bg-white rounded-[32px] border border-[#141414]/5 shadow-xl shadow-[#141414]/5 min-h-[600px] flex flex-col overflow-hidden">
              <div className="p-8 border-b border-[#141414]/5 flex items-center justify-between bg-white/50 backdrop-blur-sm">
                <div>
                  <h3 className="text-xl font-bold">Analysis Results</h3>
                  <p className="text-xs text-[#141414]/40 font-medium uppercase tracking-wider mt-1">
                    {results.length} Pages Audited
                  </p>
                </div>
                {results.length > 0 && (
                  <button
                    onClick={exportToExcel}
                    className="flex items-center gap-2 px-4 py-2 bg-[#141414]/5 hover:bg-[#141414]/10 rounded-full text-sm font-bold transition-all"
                  >
                    <Download className="w-4 h-4" /> Export XLSX
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {results.length === 0 && !isAnalyzing && (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-30 py-20">
                    <div className="w-20 h-20 border-2 border-dashed border-[#141414] rounded-full flex items-center justify-center">
                      <Search className="w-10 h-10" />
                    </div>
                    <div>
                      <p className="font-bold text-lg">No analysis run yet</p>
                      <p className="text-sm">Enter URLs or upload a file to begin the audit</p>
                    </div>
                  </div>
                )}

                {isAnalyzing && results.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-6 py-20">
                    <div className="relative">
                      <div className="w-20 h-20 border-4 border-[#141414]/5 rounded-full animate-pulse" />
                      <Loader2 className="w-10 h-10 animate-spin absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    </div>
                    <div className="space-y-2">
                      <p className="font-bold text-lg">Analyzing FAQ Content</p>
                      <p className="text-sm text-[#141414]/40 max-w-xs mx-auto">
                        We're checking your pages for local keywords, natural language, and link structure...
                      </p>
                    </div>
                  </div>
                )}

                {results.map((result, idx) => (
                  <div key={idx} className="group animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#F5F5F4] rounded-xl flex items-center justify-center text-lg font-bold">
                          {idx + 1}
                        </div>
                        <div>
                          <h4 className="font-bold text-sm truncate max-w-[300px]">{result.url}</h4>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="h-1.5 w-24 bg-[#F5F5F4] rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-[#141414] transition-all duration-1000" 
                                style={{ width: `${result.score}%` }}
                              />
                            </div>
                            <span className="text-[10px] font-bold opacity-40">{result.score}% Score</span>
                          </div>
                        </div>
                      </div>
                      {!result.faqFound && (
                        <span className="px-3 py-1 bg-rose-50 text-rose-600 text-[10px] font-bold rounded-full uppercase tracking-wider">
                          No FAQ Found
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Criteria Cards */}
                      <div className="space-y-3">
                        <div className="p-4 bg-[#F5F5F4] rounded-2xl space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider opacity-50">Hyper-Local</span>
                            <StatusBadge status={result.criteria.hyperLocal.status} />
                          </div>
                          <p className="text-xs leading-relaxed opacity-70">{result.criteria.hyperLocal.feedback}</p>
                        </div>
                        <div className="p-4 bg-[#F5F5F4] rounded-2xl space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider opacity-50">Natural Language</span>
                            <StatusBadge status={result.criteria.naturalLanguage.status} />
                          </div>
                          <p className="text-xs leading-relaxed opacity-70">{result.criteria.naturalLanguage.feedback}</p>
                        </div>
                        <div className="p-4 bg-[#F5F5F4] rounded-2xl space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider opacity-50">Concise Answers</span>
                            <StatusBadge status={result.criteria.conciseAnswers.status} />
                          </div>
                          <p className="text-xs leading-relaxed opacity-70">{result.criteria.conciseAnswers.feedback}</p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="p-4 bg-[#F5F5F4] rounded-2xl space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider opacity-50">Internal Links</span>
                            <StatusBadge status={result.criteria.internalLinks.status} />
                          </div>
                          <p className="text-xs leading-relaxed opacity-70">{result.criteria.internalLinks.feedback}</p>
                        </div>
                        <div className="p-4 bg-[#F5F5F4] rounded-2xl space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider opacity-50">Unique Content</span>
                            <StatusBadge status={result.criteria.uniqueContent.status} />
                          </div>
                          <p className="text-xs leading-relaxed opacity-70">{result.criteria.uniqueContent.feedback}</p>
                        </div>
                        <div className="p-6 bg-[#141414] text-white rounded-2xl h-full">
                          <div className="flex items-center gap-2 mb-3">
                            <Info className="w-4 h-4 opacity-50" />
                            <span className="text-[11px] font-bold uppercase tracking-wider opacity-50">Expert Summary</span>
                          </div>
                          <div className="text-xs leading-relaxed prose prose-invert prose-sm max-w-none">
                            <Markdown>{result.summary}</Markdown>
                          </div>
                        </div>
                      </div>
                    </div>
                    {idx < results.length - 1 && <div className="h-px bg-[#141414]/5 my-8" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-[#141414]/5">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="text-[10px] font-bold uppercase tracking-widest opacity-40">
              © 2026 VW PKW SEO Division
            </div>
            <div className="h-4 w-px bg-[#141414]/10 hidden md:block" />
            <div className="flex gap-4">
              <a href="#" className="text-[10px] font-bold uppercase tracking-widest opacity-40 hover:opacity-100 transition-opacity">Privacy</a>
              <a href="#" className="text-[10px] font-bold uppercase tracking-widest opacity-40 hover:opacity-100 transition-opacity">Terms</a>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest opacity-40">
            Powered by Gemini 3.1 Pro <ChevronRight className="w-3 h-3" />
          </div>
        </div>
      </footer>
    </div>
  );
}
