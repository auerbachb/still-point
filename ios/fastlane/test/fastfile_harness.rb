# frozen_string_literal: true

# Test harness for ios/fastlane/Fastfile (#838), driven by
# scripts/ci/ios-fastfile-xcargs.test.ts. It loads the real Fastfile with the few
# Fastlane DSL methods it touches replaced by stubs, so no Fastlane gem is needed,
# and prints one JSON line:
#
#   ruby fastfile_harness.rb helper <name>  -> {"value": <helper's return value>}
#   ruby fastfile_harness.rb lane <name>    -> {"gym": <options the lane passed to gym>}
#
# A UI.user_error! prints {"user_error": "<message>"} instead. Lanes register
# without running; only the one asked for runs, and only gym is stubbed for it.

require "json"

class FastfileUserError < StandardError; end

module UI
  def self.user_error!(message)
    raise FastfileUserError, message
  end
end

LANES = {}
GYM_CALLS = []

def default_platform(*); end

def platform(*)
  yield
end

def desc(*); end

def lane(name, &block)
  LANES[name] = block
end

def gym(options = {})
  GYM_CALLS << options
end

load File.expand_path("../Fastfile", __dir__)

HELPERS = %w[build_xcargs build_number_xcargs google_signin_xcargs].freeze

mode, name = ARGV
begin
  case mode
  when "helper"
    abort "unknown helper #{name.inspect}; expected one of #{HELPERS.join(', ')}" unless HELPERS.include?(name)
    puts JSON.generate("value" => send(name))
  when "lane"
    lane_block = LANES.fetch(name.to_s.to_sym) { abort "unknown lane #{name.inspect}" }
    lane_block.call
    abort "lane #{name} called gym #{GYM_CALLS.length} times; expected once" unless GYM_CALLS.length == 1
    puts JSON.generate("gym" => GYM_CALLS.first)
  else
    abort "usage: fastfile_harness.rb helper <name> | lane <name>"
  end
rescue FastfileUserError => e
  puts JSON.generate("user_error" => e.message)
end
